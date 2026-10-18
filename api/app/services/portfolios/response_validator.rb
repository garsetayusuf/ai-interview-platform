# frozen_string_literal: true

module Portfolios
  class ResponseValidator
    ROOT_KEYS = %w[configured_skills discovered_skills].freeze
    CONFIDENCE_LEVELS = PortfolioSkill::CONFIDENCE_LEVELS

    def initialize(response)
      @response = response
    end

    def call
      data = parse_response
      validate_root!(data)
      validate_skills!(data['configured_skills'], configured: true)
      validate_skills!(data['discovered_skills'], configured: false)
      data
    end

    private

    def parse_response
      data = @response.is_a?(Hash) ? @response : JSON.parse(@response)
      raise Portfolios::InvalidResponse, 'Portfolio response must be a JSON object' unless data.is_a?(Hash)

      data
    rescue JSON::ParserError
      raise Portfolios::InvalidResponse, 'Portfolio response was not valid JSON'
    end

    def validate_root!(data)
      ROOT_KEYS.each do |key|
        raise Portfolios::InvalidResponse, "Portfolio response missing #{key}" unless data[key].is_a?(Array)
      end
    end

    def validate_skills!(skills, configured:)
      seen = {}

      skills.each do |skill|
        raise Portfolios::InvalidResponse, 'Portfolio skill must be an object' unless skill.is_a?(Hash)

        skill_id = skill['skill_id'].to_s if configured
        label = skill['skill_label'].to_s.strip
        identity = configured ? skill_id : label.downcase

        raise Portfolios::InvalidResponse, 'Portfolio skill identity is missing' if identity.blank?
        raise Portfolios::InvalidResponse, 'Portfolio skill is duplicated' if seen[identity]

        seen[identity] = true
        validate_skill_fields!(skill, configured:)
      end
    end

    def validate_skill_fields!(skill, configured:)
      if configured && skill['skill_id'].to_s.strip.blank?
        raise Portfolios::InvalidResponse, 'Configured portfolio skill_id is missing'
      end

      raise Portfolios::InvalidResponse, 'Portfolio skill_label is missing' unless skill['skill_label'].is_a?(String) && skill['skill_label'].strip.present?
      raise Portfolios::InvalidResponse, 'Portfolio level must be an integer from 1 to 5' unless skill['level'].is_a?(Integer) && skill['level'].between?(1, 5)
      raise Portfolios::InvalidResponse, 'Portfolio confidence is invalid' unless CONFIDENCE_LEVELS.include?(skill['confidence'].to_s)
      raise Portfolios::InvalidResponse, 'Portfolio evidence must contain candidate quotes' unless skill['evidence'].is_a?(Array) && skill['evidence'].any? { |quote| quote.is_a?(String) && quote.strip.present? }
      raise Portfolios::InvalidResponse, 'Portfolio competency summary is missing' unless skill['competency_summary'].is_a?(String) && skill['competency_summary'].strip.present?
    end
  end
end
