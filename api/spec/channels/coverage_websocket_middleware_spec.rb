# frozen_string_literal: true

require 'rails_helper'

RSpec.describe CoverageWebSocketMiddleware do
  let(:middleware) { described_class.new(->(_env) { [404, {}, []] }) }
  let(:owner_organization) { create(:organization) }
  let(:foreign_organization) { create(:organization) }
  let(:assessment) { create(:assessment, organization: owner_organization) }
  let(:session) { create(:session, organization: owner_organization, assessment:, status: 'active') }

  def token_for(organization, role: 'admin')
    JsonWebToken.encode(user_id: 70_001, role:, scheme: organization.scheme)
  end

  it 'authenticates an assessor for a session in the token tenant' do
    result, error = middleware.send(:authenticate_assessor_by_token, token_for(owner_organization), session.id)

    expect(error).to be_nil
    expect(result).to eq(session)
  end

  it 'rejects a valid token with a non-assessor role' do
    result, error = middleware.send(:authenticate_assessor_by_token, token_for(owner_organization, role: 'user'), session.id)

    expect(result).to be_nil
    expect(error).to include('Unauthorized')
  end

  it 'rejects a session belonging to another tenant' do
    result, error = middleware.send(:authenticate_assessor_by_token, token_for(foreign_organization), session.id)

    expect(result).to be_nil
    expect(error).to eq('Session not found')
  end
end
