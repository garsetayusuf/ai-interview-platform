# frozen_string_literal: true

require 'rails_helper'

RSpec.describe FitGapGeneratorWorker do
  let(:owner_organization) { create(:organization) }
  let(:foreign_organization) { create(:organization) }
  let(:assessment) { create(:assessment, organization: owner_organization) }
  let(:session) { create(:session, organization: owner_organization, assessment:) }
  let(:portfolio) { create(:portfolio, organization: owner_organization, session:) }
  let(:owner_vacancy) { create(:vacancy, organization: owner_organization) }
  let(:foreign_vacancy) { create(:vacancy, organization: foreign_organization) }

  it 'validates persisted tenant ownership without request-local Current context' do
    Current.clear
    engine = instance_double(FitGap::Engine, call: true)
    allow(FitGap::Engine).to receive(:new).and_return(engine)

    described_class.new.perform(portfolio.id, owner_vacancy.id)

    expect(FitGap::Engine).to have_received(:new).with(portfolio:, vacancy: owner_vacancy)
    expect(engine).to have_received(:call)
  end

  it 'does not invoke the engine for a portfolio and vacancy from different tenants' do
    Current.clear
    expect(FitGap::Engine).not_to receive(:new)

    described_class.new.perform(portfolio.id, foreign_vacancy.id)
  end
end
