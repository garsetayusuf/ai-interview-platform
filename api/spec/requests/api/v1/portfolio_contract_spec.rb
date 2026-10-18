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

    it 'exposes an override context list and defaults it to empty' do
      create(
        :fit_gap_report,
        portfolio:,
        vacancy:,
        skill_comparisons: [{ 'skill_label' => 'Ruby', 'result' => 'gap' }],
        override_context: [
          {
            'skill_label'    => 'Communication',
            'skill_id'       => 'communication',
            'ai_level'       => 2,
            'override_level' => 5
          }
        ]
      )

      get "/api/v1/portfolios/#{portfolio.id}/fitgap/#{vacancy.id}", headers: headers

      expect(response).to have_http_status(:ok)
      report = JSON.parse(response.body).fetch('report')

      expect(report.fetch('override_context')).to eq(
        [
          {
            'skill_label'    => 'Communication',
            'skill_id'       => 'communication',
            'ai_level'       => 2,
            'override_level' => 5
          }
        ]
      )
    end
  end

  describe 'POST /api/v1/portfolios/:id/fitgap' do
    let(:stored_comparisons) { [{ 'skill_label' => 'Ruby', 'result' => 'gap' }] }

    before { allow(FitGapGeneratorWorker).to receive(:perform_async) }

    it 'queues regeneration instead of serving a report older than the portfolio' do
      portfolio.update!(generation_status: 'complete', generated_at: 1.hour.ago)
      create(:fit_gap_report, portfolio:, vacancy:, skill_comparisons: stored_comparisons, generated_at: 2.hours.ago)

      post "/api/v1/portfolios/#{portfolio.id}/fitgap",
           params:  { fitgap: { vacancy_id: vacancy.id } },
           headers: headers,
           as:      :json

      expect(response).to have_http_status(:accepted)
      expect(JSON.parse(response.body).fetch('status')).to eq('generating')
      expect(FitGapGeneratorWorker).to have_received(:perform_async).with(portfolio.id, vacancy.id)
    end

    it 'serves the stored report while it is newer than the portfolio' do
      portfolio.update!(generation_status: 'complete', generated_at: 2.hours.ago)
      report = create(:fit_gap_report, portfolio:, vacancy:, skill_comparisons: stored_comparisons, generated_at: 1.hour.ago)

      post "/api/v1/portfolios/#{portfolio.id}/fitgap",
           params:  { fitgap: { vacancy_id: vacancy.id } },
           headers: headers,
           as:      :json

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).fetch('report').fetch('id')).to eq(report.id)
      expect(FitGapGeneratorWorker).not_to have_received(:perform_async)
    end

    it 'queues a comparison when nothing is stored yet' do
      portfolio.update!(generation_status: 'complete')

      post "/api/v1/portfolios/#{portfolio.id}/fitgap",
           params:  { fitgap: { vacancy_id: vacancy.id } },
           headers: headers,
           as:      :json

      expect(response).to have_http_status(:accepted)
      expect(FitGapGeneratorWorker).to have_received(:perform_async).with(portfolio.id, vacancy.id)
    end
  end

  describe 'POST /api/v1/portfolios/:id/regenerate_fitgap' do
    it 'keeps the current report readable while a replacement is queued' do
      portfolio.update!(generation_status: 'complete')
      report = create(
        :fit_gap_report,
        portfolio:,
        vacancy:,
        skill_comparisons: [{ 'skill_label' => 'Ruby', 'result' => 'gap' }],
        generated_at: 1.hour.ago
      )

      post "/api/v1/portfolios/#{portfolio.id}/regenerate_fitgap",
           params:  { vacancy_id: vacancy.id },
           headers: headers,
           as:      :json

      expect(response).to have_http_status(:accepted)
      expect(
        FitGapReport.find_by(portfolio_id: portfolio.id, vacancy_id: vacancy.id)
      ).to eq(report)

      get "/api/v1/portfolios/#{portfolio.id}/fitgap/#{vacancy.id}", headers: headers

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).fetch('report').fetch('generated_at')).to be_present
    end
  end

  describe 'GET /api/v1/portfolios/:id/export' do
    it 'carries the recorded consent beside the portfolio' do
      session.update!(consent_accepted_at: Time.zone.parse('2026-10-18 09:00:00'), consent_version: 'v1')

      get "/api/v1/portfolios/#{portfolio.id}/export", params: { format: 'json' }, headers: headers

      expect(response).to have_http_status(:ok)
      consent = JSON.parse(response.body).fetch('consent')
      expect(consent.fetch('version')).to eq('v1')
      expect(consent.fetch('accepted_at')).to be_present
      expect(consent.fetch('declined_at')).to be_nil
    end

    it 'reports a decline rather than pretending consent exists' do
      session.update!(consent_declined_at: Time.current)

      get "/api/v1/portfolios/#{portfolio.id}/export", params: { format: 'json' }, headers: headers

      expect(response).to have_http_status(:ok)
      consent = JSON.parse(response.body).fetch('consent')
      expect(consent.fetch('accepted_at')).to be_nil
      expect(consent.fetch('declined_at')).to be_present
    end
  end

  describe 'POST /api/v1/portfolio_skills/:id/override' do
    it 'queues regeneration without destroying the stored comparison' do
      portfolio.update!(generation_status: 'complete')
      skill = create(:portfolio_skill, portfolio:, skill_label: 'Ruby')
      report = create(
        :fit_gap_report,
        portfolio:,
        vacancy:,
        skill_comparisons: [{ 'skill_label' => 'Ruby', 'result' => 'gap' }],
        generated_at: 1.hour.ago
      )

      allow(FitGapGeneratorWorker).to receive(:perform_async)

      post "/api/v1/portfolio_skills/#{skill.id}/override",
           params:  { override: { override_level: 4, assessor_notes: 'Synthetic note.' } },
           headers: headers,
           as:      :json

      expect(response).to have_http_status(:created)
      expect(FitGapReport.find_by(id: report.id)).to be_present
      expect(FitGapGeneratorWorker).to have_received(:perform_async).with(portfolio.id, vacancy.id)
    end
  end
end
