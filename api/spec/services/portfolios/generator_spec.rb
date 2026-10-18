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
end
