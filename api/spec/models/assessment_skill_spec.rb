# frozen_string_literal: true

require 'rails_helper'

RSpec.describe AssessmentSkill do
  let(:organization) { create(:organization) }

  it 'keeps legacy nullable skill config editable when unrelated fields change' do
    assessment = create(:assessment, organization:)
    skill = described_class.insert!(
      assessment_id: assessment.id,
      skill_label: 'Legacy skill',
      is_custom: false,
      display_order: 0,
      expected_level: 3
    )
    skill.reload

    skill.update!(skill_label: 'Renamed legacy skill')

    expect(skill.reload.skill_label).to eq('Renamed legacy skill')
  end

  it 'still rejects missing scope on a new configured skill' do
    skill = build(:assessment_skill, organization:, scope_include: nil)

    expect(skill).not_to be_valid
    expect(skill.errors.full_messages).to include('Skill scope is required')
  end
end
