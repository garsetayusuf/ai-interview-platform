# frozen_string_literal: true

require 'rails_helper'

RSpec.describe FitGap::Engine do
  let(:organization) { create(:organization) }
  let(:assessment) { create(:assessment, organization:) }
  let(:session) { create(:session, organization:, assessment:) }
  let(:portfolio) { create(:portfolio, organization:, session:) }
  let(:vacancy) { create(:vacancy, organization:) }
  let(:gemini_client) do
    instance_double(
      Gemini::HttpClient,
      generate_content: {
        'culture_narrative' => 'Synthetic culture narrative.',
        'overall_narrative' => 'Synthetic overall narrative.'
      }
    )
  end

  before do
    create(:vacancy_skill, vacancy:, skill_id: 'ruby', skill_label: 'Ruby', expected_level: 4)
  end

  it 'emits the canonical required level and numeric candidate level' do
    create(
      :portfolio_skill,
      portfolio:,
      skill_id: 'ruby',
      skill_label: 'Ruby',
      ai_level: 3,
      ai_confidence: 'high'
    )

    report = described_class.new(portfolio:, vacancy:, gemini_client:).call
    comparison = report.skill_comparisons.first

    expect(comparison).to include(
      'skill_id' => 'ruby',
      'required_level' => 4,
      'candidate_level' => 3,
      'result' => 'gap',
      'delta' => -1,
      'confidence' => 'high',
      'is_override' => false,
      'candidate_level_source' => 'ai'
    )
  end

  it 'uses the assessor override as the effective rating' do
    skill = create(
      :portfolio_skill,
      portfolio:,
      skill_id: 'ruby',
      skill_label: 'Ruby',
      ai_level: 3,
      ai_confidence: 'medium'
    )
    create(:assessor_override, portfolio_skill: skill, override_level: 4)

    comparison = described_class.new(portfolio:, vacancy:, gemini_client:).call.skill_comparisons.first

    expect(comparison).to include(
      'candidate_level' => 4,
      'result' => 'match',
      'delta' => 0,
      'is_override' => true,
      'candidate_level_source' => 'assessor_override'
    )
  end

  it 'marks a missing portfolio skill as not assessed without inventing a rating' do
    comparison = described_class.new(portfolio:, vacancy:, gemini_client:).call.skill_comparisons.first

    expect(comparison).to include(
      'required_level' => 4,
      'candidate_level' => nil,
      'result' => 'not_assessed',
      'delta' => nil,
      'confidence' => nil,
      'assessment_state' => 'not_assessed'
    )
  end

  it 'supports the minimum and maximum required levels' do
    vacancy.vacancy_skills.first.update!(expected_level: 1)
    create(:portfolio_skill, portfolio:, skill_id: 'ruby', skill_label: 'Ruby', ai_level: 1)

    low_comparison = described_class.new(portfolio:, vacancy:, gemini_client:).call.skill_comparisons.first
    expect(low_comparison.fetch('candidate_level')).to eq(1)

    vacancy.vacancy_skills.first.update!(expected_level: 5)
    portfolio.portfolio_skills.first.update!(ai_level: 5)

    high_comparison = described_class.new(portfolio:, vacancy:, gemini_client:).call.skill_comparisons.first
    expect(high_comparison.fetch('candidate_level')).to eq(5)
  end
end
