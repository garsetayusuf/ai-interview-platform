# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Portfolio and fit-gap API contracts', type: :request do
  let(:organization) { create(:organization) }
  let(:assessment) { create(:assessment, organization:) }
  let(:session) { create(:session, organization:, assessment:) }
  let(:portfolio) { create(:portfolio, organization:, session:) }
  let(:vacancy) { create(:vacancy, organization:) }
  let(:headers) { assessor_headers(organization) }

  describe 'GET /api/v1/sessions/:id/portfolio' do
    it 'returns numeric skill levels and visible override data' do
      skill = create(:portfolio_skill, portfolio:, ai_level: 2, ai_confidence: 'medium')
      override = create(:assessor_override, portfolio_skill: skill, override_level: 4)

      get "/api/v1/sessions/#{session.id}/portfolio", headers: headers

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      returned_skill = body.fetch('portfolio').fetch('skills').first
      returned_override = body.fetch('portfolio').fetch('overrides').first

      expect(returned_skill.fetch('ai_level')).to be_a(Integer)
      expect(returned_skill.fetch('ai_level')).to be_between(1, 5).inclusive
      expect(returned_override).to include(
        'portfolio_skill_id' => skill.id,
        'ai_level' => 2,
        'override_level' => 4,
        'id' => override.id
      )
      expect(returned_skill).to include('assessment_state' => 'assessed')
    end

    it 'returns a controlled failed-generation response' do
      portfolio.update!(generation_status: 'failed', generation_error: 'Synthetic generation failure')

      get "/api/v1/sessions/#{session.id}/portfolio", headers: headers

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)

      expect(body.fetch('error')).to eq('Synthetic generation failure')
      expect(body.fetch('portfolio').fetch('generation_status')).to eq('failed')
    end
  end

  describe 'GET /api/v1/portfolios/:id/fitgap/:vacancy_id' do
    it 'returns canonical required-level and unassessed fields' do
      create(
        :fit_gap_report,
        portfolio:,
        vacancy:,
        skill_comparisons: [
          {
            'skill_id' => 'ruby',
            'skill_label' => 'Ruby',
            'required_level' => 4,
            'candidate_level' => nil,
            'result' => 'not_assessed',
            'delta' => nil,
            'confidence' => nil,
            'assessment_state' => 'not_assessed',
            'is_override' => false
          }
        ]
      )

      get "/api/v1/portfolios/#{portfolio.id}/fitgap/#{vacancy.id}", headers: headers

      expect(response).to have_http_status(:ok)
      comparison = JSON.parse(response.body).fetch('report').fetch('skill_comparisons').first

      expect(comparison).to include(
        'required_level' => 4,
        'candidate_level' => nil,
        'result' => 'not_assessed',
        'delta' => nil,
        'confidence' => nil,
        'assessment_state' => 'not_assessed',
        'is_override' => false
      )
    end

    it 'rejects an invalid portfolio identifier without leaking data' do
      get "/api/v1/portfolios/999999999/fitgap/#{vacancy.id}", headers: headers

      expect(response).to have_http_status(:not_found)
    end
  end
end
