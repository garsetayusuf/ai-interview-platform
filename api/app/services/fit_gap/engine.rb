# frozen_string_literal: true

module FitGap
  # N13: Generates a fit/gap report comparing a portfolio against a vacancy.
  # Uses rule-based comparison for skill levels + Gemini Flash for culture narrative.
  class Engine
    def initialize(portfolio:, vacancy:, gemini_client: nil)
      @portfolio = portfolio
      @vacancy   = vacancy
      @gemini_client = gemini_client || Gemini::HttpClient.new(
        model:   ENV.fetch('GEMINI_FLASH_MODEL', 'gemini-2.5-flash'),
        timeout: 30
      )
    end

    # Returns the FitGapReport record.
    def call
      skill_comparisons = build_skill_comparisons
      narratives        = generate_narratives(skill_comparisons)

      report = FitGapReport.find_or_initialize_by(
        portfolio_id: @portfolio.id,
        vacancy_id:   @vacancy.id
      )

      report.update!(
        skill_comparisons: skill_comparisons,
        override_context:  build_override_context,
        culture_narrative: narratives[:culture],
        overall_narrative: narratives[:overall],
        generated_at:      Time.current
      )

      Rails.logger.info("[N13] Fit/gap report generated: portfolio=#{@portfolio.id} vacancy=#{@vacancy.id}")
      report
    end

    private

    def build_skill_comparisons
      portfolio_skills = effective_portfolio_skills
      @matched_portfolio_skill_ids = []

      comparisons = @vacancy.vacancy_skills.map do |vacancy_skill|
        portfolio_skill = find_portfolio_skill(portfolio_skills, vacancy_skill.skill_label, vacancy_skill.skill_id)
        required_level = vacancy_skill.expected_level
        is_override = portfolio_skill&.dig(:overridden) || false
        candidate_level_source =
          if portfolio_skill
            is_override ? 'assessor_override' : 'ai'
          end

        if portfolio_skill
          @matched_portfolio_skill_ids << portfolio_skill[:id]
          candidate_level = portfolio_skill[:effective_level]
          delta = candidate_level - required_level
          result = delta == 0 ? 'match' : (delta > 0 ? 'exceed' : 'gap')
          assessment_state = 'assessed'
        else
          candidate_level = nil
          delta = nil
          result = 'not_assessed'
          # Evidence existed for the skill but not enough to support a level.
          assessment_state = coverage_evidence?(vacancy_skill) ? 'insufficient_evidence' : 'not_assessed'
        end

        {
          skill_label: vacancy_skill.skill_label,
          skill_id: vacancy_skill.skill_id,
          required_level:,
          candidate_level:,
          result:,
          delta:,
          confidence: portfolio_skill&.dig(:confidence),
          assessment_state:,
          is_override:,
          candidate_level_source:
        }
      end

      comparisons
    end

    # Assessor corrections on skills this vacancy never asked about, so a human
    # override can be read from the report even when it has no comparison row.
    def build_override_context
      matched_ids = @matched_portfolio_skill_ids || []

      (@portfolio_skills || []).filter_map do |skill|
        next unless skill[:overridden]
        next if matched_ids.include?(skill[:id])

        {
          skill_label:    skill[:skill_label],
          skill_id:       skill[:skill_id],
          ai_level:       skill[:ai_level],
          override_level: skill[:effective_level]
        }
      end
    end

    # Returns portfolio skills with overrides applied.
    def effective_portfolio_skills
      @portfolio_skills ||= @portfolio.portfolio_skills.includes(:assessor_override).map do |skill|
        override = skill.assessor_override
        {
          id:              skill.id,
          skill_id:        skill.skill_id,
          skill_label:     skill.skill_label,
          ai_level:        skill.ai_level,
          effective_level: override ? override.override_level : skill.ai_level,
          confidence:      skill.ai_confidence,
          overridden:      override.present?
        }
      end
    end

    def find_portfolio_skill(portfolio_skills, label, skill_id)
      return portfolio_skills.find { |s| s[:skill_id] == skill_id } if skill_id.present?

      normalized = normalize_skill_label(label)
      portfolio_skills.find { |s| normalize_skill_label(s[:skill_label]) == normalized }
    end

    # Labels arrive from two configuration surfaces, so compare them folded:
    # case, surrounding space and repeated internal whitespace must not hide a match.
    def normalize_skill_label(label)
      label.to_s.downcase.strip.gsub(/\s+/, ' ')
    end

    # Coverage rows exist once the interview probed a skill. A non-`not_yet`
    # state means the candidate was asked about it but no rated skill was kept.
    def coverage_evidence?(vacancy_skill)
      key = vacancy_skill.skill_id.presence
      label = vacancy_skill.skill_label.to_s.downcase

      coverage_maps.any? do |map|
        next false if map.state == 'not_yet'

        (key.present? && map.skill_id == key) || map.skill_label.to_s.downcase == label
      end
    end

    def coverage_maps
      @coverage_maps ||= @portfolio.session.coverage_maps.to_a
    end

    def generate_narratives(skill_comparisons)
      gaps    = skill_comparisons.select { |c| c[:result] == 'gap' }
      matches = skill_comparisons.select { |c| c[:result] == 'match' }
      exceeds = skill_comparisons.select { |c| c[:result] == 'exceed' }
      not_assessed = skill_comparisons.select { |c| c[:result] == 'not_assessed' }

      prompt = build_narrative_prompt(gaps, matches, exceeds, not_assessed)

      begin
        response = @gemini_client.generate_content(prompt, temperature: 0.4)
        data = response.is_a?(Hash) ? response : JSON.parse(response)
        { culture: data['culture_narrative'], overall: data['overall_narrative'] }
      rescue => e
        # The message can quote the prompt or the raw provider response.
        Rails.logger.error("[N13] Narrative generation failed: #{e.class}")
        { culture: nil, overall: generate_fallback_narrative(skill_comparisons) }
      end
    end

    def build_narrative_prompt(gaps, matches, exceeds, not_assessed)
      vacancy = @vacancy

      <<~PROMPT
        You are writing a fit/gap analysis narrative for a candidate evaluation.

        ROLE: #{vacancy.role_title}
        #{vacancy.culture_dimensions.present? ? "CULTURE EXPECTATIONS:\n#{vacancy.culture_dimensions}\n" : ""}
        #{vacancy.competency_expectations.present? ? "COMPETENCY EXPECTATIONS:\n#{vacancy.competency_expectations}\n" : ""}

        SKILL COMPARISON RESULTS:
        - Matches (#{matches.count}): #{matches.map { |c| "#{c[:skill_label]} (L#{c[:candidate_level]})" }.join(', ')}
        - Gaps (#{gaps.count}): #{gaps.map { |c| "#{c[:skill_label]}: candidate L#{c[:candidate_level]} vs required L#{c[:required_level]} (delta #{c[:delta]})" }.join(', ')}
        - Exceeds (#{exceeds.count}): #{exceeds.map { |c| "#{c[:skill_label]}: candidate L#{c[:candidate_level]} vs required L#{c[:required_level]} (+#{c[:delta]})" }.join(', ')}
        - Not assessed (#{not_assessed.count}): #{not_assessed.map { |c| c[:skill_label] }.join(', ')}

        Write two short narrative paragraphs:
        1. culture_narrative: 2-3 sentences on culture/competency fit based on the comparison patterns.
        2. overall_narrative: 2-3 sentence overall hiring recommendation summary.

        OUTPUT (JSON only):
        {
          "culture_narrative": "...",
          "overall_narrative": "..."
        }
      PROMPT
    end

    def generate_fallback_narrative(comparisons)
      gaps    = comparisons.count { |c| c[:result] == 'gap' }
      matches = comparisons.count { |c| c[:result] == 'match' }
      exceeds = comparisons.count { |c| c[:result] == 'exceed' }

      "Candidate shows #{matches} skill matches, #{exceeds} exceeds, and #{gaps} gaps against role requirements."
    end
  end
end
