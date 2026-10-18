# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Portfolios::ResponseValidator do
  def skill(level)
    {
      'skill_id' => 'skill-ruby',
      'skill_label' => 'Ruby',
      'level' => level,
      'confidence' => 'medium',
      'evidence' => ['Candidate quote.'],
      'competency_summary' => 'Synthetic summary.'
    }
  end

  it 'normalizes a numeric string level from the provider' do
    result = described_class.new({
      'configured_skills' => [skill('3')],
      'discovered_skills' => []
    }).call

    expect(result['configured_skills'].first['level']).to eq(3)
  end

  it 'normalizes an L-prefixed level from the provider' do
    result = described_class.new({
      'configured_skills' => [skill('L4')],
      'discovered_skills' => []
    }).call

    expect(result['configured_skills'].first['level']).to eq(4)
  end

  it 'still rejects an out-of-range level' do
    expect {
      described_class.new({ 'configured_skills' => [skill('L6')], 'discovered_skills' => [] }).call
    }.to raise_error(Portfolios::InvalidResponse, 'Portfolio level must be an integer from 1 to 5')
  end
end
