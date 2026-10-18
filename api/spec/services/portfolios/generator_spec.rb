# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Portfolios::Generator do
  let(:organization) { create(:organization) }
  let(:assessment) { create(:assessment, organization:) }
  let(:session) { create(:session, organization:, assessment:, status: 'ended') }
  let(:gemini_client) { instance_double(Gemini::HttpClient) }

  it 'persists numeric levels and evidence from a valid response' do
    allow(gemini_client).to receive(:generate_content).and_return(
      {
        'configured_skills' => [
          {
            'skill_id' => 'ruby',
            'skill_label' => 'Ruby',
            'level' => 3,
            'confidence' => 'high',
            'evidence' => ['Synthetic candidate evidence.'],
            'competency_summary' => 'Synthetic summary.'
          }
        ],
        'discovered_skills' => []
      }
    )

    portfolio = described_class.new(session:, gemini_client:).call
    skill = portfolio.portfolio_skills.first

    expect(skill.ai_level).to be_an(Integer).and be_between(1, 5).inclusive
    expect(skill.ai_confidence).to eq('high')
    expect(skill.evidence_quotes).to eq(['Synthetic candidate evidence.'])
  end

  it 'clears stale provider errors when regeneration completes' do
    create(
      :portfolio,
      organization:,
      session:,
      generation_status: 'failed',
      generation_error: 'API returned 503'
    )
    allow(gemini_client).to receive(:generate_content).and_return(
      {
        'configured_skills' => [],
        'discovered_skills' => []
      }
    )

    result = described_class.new(session:, gemini_client:).call

    expect(result).to be_complete
    expect(result.generation_error).to be_nil
  end

  it 'does not silently convert a malformed level into a valid rating' do
    allow(gemini_client).to receive(:generate_content).and_return(
      {
        'configured_skills' => [
          {
            'skill_id' => 'ruby',
            'skill_label' => 'Ruby',
            'level' => 'not-a-level',
            'confidence' => 'high',
            'evidence' => ['Synthetic candidate evidence.'],
            'competency_summary' => 'Synthetic summary.'
          }
        ],
        'discovered_skills' => []
      }
    )

    portfolio = described_class.new(session:, gemini_client:).call

    expect(portfolio).to be_failed
    expect(portfolio.generation_error).to eq('Portfolio level must be an integer from 1 to 5')
    expect(portfolio.portfolio_skills).to be_empty
  end

  it 'supports an empty but valid response without fabricating skills' do
    allow(gemini_client).to receive(:generate_content).and_return(
      { 'configured_skills' => [], 'discovered_skills' => [] }
    )

    portfolio = described_class.new(session:, gemini_client:).call

    expect(portfolio).to be_complete
    expect(portfolio.portfolio_skills).to be_empty
  end
  it 'preserves an assessor override when regenerating the same skill' do
    portfolio = create(:portfolio, organization:, session:, generation_status: 'failed')
    skill = create(:portfolio_skill, portfolio:, skill_id: 'ruby', skill_label: 'Ruby', ai_level: 3)
    create(:assessor_override, portfolio_skill: skill, override_level: 4)
    allow(gemini_client).to receive(:generate_content).and_return(
      {
        'configured_skills' => [
          {
            'skill_id' => 'ruby',
            'skill_label' => 'Ruby',
            'level' => 5,
            'confidence' => 'high',
            'evidence' => ['Synthetic regenerated evidence.'],
            'competency_summary' => 'Synthetic regenerated summary.'
          }
        ],
        'discovered_skills' => []
      }
    )

    described_class.new(session:, gemini_client:).call

    skill.reload
    expect(skill.ai_level).to eq(5)
    expect(skill.assessor_override.override_level).to eq(4)
  end

  it 'preserves the prior portfolio and fit-gap report when regeneration is rejected' do
    portfolio = create(:portfolio, organization:, session:, generation_status: 'failed')
    skill = create(:portfolio_skill, portfolio:, skill_id: 'ruby', skill_label: 'Ruby', ai_level: 3)
    vacancy = create(:vacancy, organization:)
    report = create(:fit_gap_report, portfolio:, vacancy:, skill_comparisons: [{ 'result' => 'match' }])
    allow(gemini_client).to receive(:generate_content).and_return(
      {
        'configured_skills' => [
          {
            'skill_id' => 'ruby',
            'skill_label' => 'Ruby',
            'level' => 'invalid',
            'confidence' => 'high',
            'evidence' => ['Synthetic invalid evidence.'],
            'competency_summary' => 'Synthetic invalid summary.'
          }
        ],
        'discovered_skills' => []
      }
    )

    result = described_class.new(session:, gemini_client:).call

    expect(result).to be_failed
    expect(skill.reload.ai_level).to eq(3)
    expect(FitGapReport.exists?(report.id)).to be(true)
    expect(report.reload.skill_comparisons).to eq([{ 'result' => 'match' }])
  end

  it 'does not invoke the provider for a completed duplicate generation' do
    allow(gemini_client).to receive(:generate_content).and_return(
      {
        'configured_skills' => [
          {
            'skill_id' => 'ruby',
            'skill_label' => 'Ruby',
            'level' => 3,
            'confidence' => 'high',
            'evidence' => ['Synthetic evidence.'],
            'competency_summary' => 'Synthetic summary.'
          }
        ],
        'discovered_skills' => []
      }
    )

    first = described_class.new(session:, gemini_client:).call
    second = described_class.new(session:, gemini_client:).call

    expect(first.id).to eq(second.id)
    expect(gemini_client).to have_received(:generate_content).once
    expect(second.portfolio_skills.count).to eq(1)
  end

  it 'does not invoke the provider while another generation is in progress' do
    portfolio = create(:portfolio, organization:, session:, generation_status: 'generating')

    expect(gemini_client).not_to receive(:generate_content)

    result = described_class.new(session:, gemini_client:).call

    expect(result.id).to eq(portfolio.id)
    expect(result).to be_generating
  end
end
