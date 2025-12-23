-- Guthwine Row-Level Security Policies
-- This migration enables tenant isolation at the database level

-- Enable Row Level Security on all tenant-scoped tables
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Agent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Policy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DelegationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TransactionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TransactionReconciliation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "APIKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Webhook" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SemanticRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SemanticEvaluation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;

-- Create function to get current organization ID from session
CREATE OR REPLACE FUNCTION current_org_id() RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('guthwine.current_org_id', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check if user is system admin
CREATE OR REPLACE FUNCTION is_system_admin() RETURNS BOOLEAN AS $$
BEGIN
  RETURN current_setting('guthwine.is_system_admin', true) = 'true';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- ORGANIZATION POLICIES
-- =============================================================================

-- Organizations: Users can only see their own org (or child orgs)
CREATE POLICY org_isolation ON "Organization"
  FOR ALL
  USING (
    is_system_admin() OR 
    id = current_org_id() OR
    "parentOrganizationId" = current_org_id()
  );

-- =============================================================================
-- USER POLICIES
-- =============================================================================

-- Users: Can only see users in their organization
CREATE POLICY user_org_isolation ON "User"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- AGENT POLICIES
-- =============================================================================

-- Agents: Can only see agents in their organization
CREATE POLICY agent_org_isolation ON "Agent"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- POLICY POLICIES
-- =============================================================================

-- Policies: Can only see policies in their organization
CREATE POLICY policy_org_isolation ON "Policy"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- POLICY ASSIGNMENT POLICIES
-- =============================================================================

-- PolicyAssignment: Based on policy's organization
CREATE POLICY policy_assignment_org_isolation ON "PolicyAssignment"
  FOR ALL
  USING (
    is_system_admin() OR 
    EXISTS (
      SELECT 1 FROM "Policy" p 
      WHERE p.id = "policyId" AND p."organizationId" = current_org_id()
    )
  );

-- =============================================================================
-- DELEGATION TOKEN POLICIES
-- =============================================================================

-- DelegationToken: Can only see delegations in their organization
CREATE POLICY delegation_org_isolation ON "DelegationToken"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- TRANSACTION POLICIES
-- =============================================================================

-- TransactionRequest: Can only see transactions in their organization
CREATE POLICY transaction_org_isolation ON "TransactionRequest"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- TransactionReconciliation: Based on transaction's organization
CREATE POLICY reconciliation_org_isolation ON "TransactionReconciliation"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- AUDIT LOG POLICIES
-- =============================================================================

-- AuditLog: Can only see audit logs in their organization
CREATE POLICY audit_org_isolation ON "AuditLog"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- API KEY POLICIES
-- =============================================================================

-- APIKey: Can only see API keys in their organization
CREATE POLICY apikey_org_isolation ON "APIKey"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- WEBHOOK POLICIES
-- =============================================================================

-- Webhook: Can only see webhooks in their organization
CREATE POLICY webhook_org_isolation ON "Webhook"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- WebhookDelivery: Based on webhook's organization
CREATE POLICY webhook_delivery_org_isolation ON "WebhookDelivery"
  FOR ALL
  USING (
    is_system_admin() OR 
    EXISTS (
      SELECT 1 FROM "Webhook" w 
      WHERE w.id = "webhookId" AND w."organizationId" = current_org_id()
    )
  );

-- =============================================================================
-- USAGE & BILLING POLICIES
-- =============================================================================

-- UsageRecord: Can only see usage records in their organization
CREATE POLICY usage_org_isolation ON "UsageRecord"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- BillingEvent: Can only see billing events in their organization
CREATE POLICY billing_org_isolation ON "BillingEvent"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- COMPLIANCE POLICIES
-- =============================================================================

-- ComplianceReport: Can only see compliance reports in their organization
CREATE POLICY compliance_org_isolation ON "ComplianceReport"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- SEMANTIC FIREWALL POLICIES
-- =============================================================================

-- SemanticRule: Can only see semantic rules in their organization
CREATE POLICY semantic_rule_org_isolation ON "SemanticRule"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- SemanticEvaluation: Can only see semantic evaluations in their organization
CREATE POLICY semantic_eval_org_isolation ON "SemanticEvaluation"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- SESSION POLICIES
-- =============================================================================

-- Session: Based on user's organization
CREATE POLICY session_org_isolation ON "Session"
  FOR ALL
  USING (
    is_system_admin() OR 
    "organizationId" = current_org_id()
  );

-- =============================================================================
-- HELPER FUNCTIONS FOR APPLICATION
-- =============================================================================

-- Function to set the current organization context
CREATE OR REPLACE FUNCTION set_org_context(org_id TEXT) RETURNS VOID AS $$
BEGIN
  PERFORM set_config('guthwine.current_org_id', org_id, true);
END;
$$ LANGUAGE plpgsql;

-- Function to set system admin context
CREATE OR REPLACE FUNCTION set_system_admin_context(is_admin BOOLEAN) RETURNS VOID AS $$
BEGIN
  PERFORM set_config('guthwine.is_system_admin', is_admin::TEXT, true);
END;
$$ LANGUAGE plpgsql;

-- Function to clear context (for connection pooling)
CREATE OR REPLACE FUNCTION clear_context() RETURNS VOID AS $$
BEGIN
  PERFORM set_config('guthwine.current_org_id', '', true);
  PERFORM set_config('guthwine.is_system_admin', 'false', true);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- INDEXES FOR RLS PERFORMANCE
-- =============================================================================

-- These indexes help RLS policies perform efficiently
CREATE INDEX IF NOT EXISTS idx_user_org ON "User"("organizationId");
CREATE INDEX IF NOT EXISTS idx_agent_org ON "Agent"("organizationId");
CREATE INDEX IF NOT EXISTS idx_policy_org ON "Policy"("organizationId");
CREATE INDEX IF NOT EXISTS idx_delegation_org ON "DelegationToken"("organizationId");
CREATE INDEX IF NOT EXISTS idx_transaction_org ON "TransactionRequest"("organizationId");
CREATE INDEX IF NOT EXISTS idx_audit_org ON "AuditLog"("organizationId");
CREATE INDEX IF NOT EXISTS idx_apikey_org ON "APIKey"("organizationId");
CREATE INDEX IF NOT EXISTS idx_webhook_org ON "Webhook"("organizationId");
CREATE INDEX IF NOT EXISTS idx_usage_org ON "UsageRecord"("organizationId");
CREATE INDEX IF NOT EXISTS idx_billing_org ON "BillingEvent"("organizationId");
CREATE INDEX IF NOT EXISTS idx_compliance_org ON "ComplianceReport"("organizationId");
CREATE INDEX IF NOT EXISTS idx_semantic_rule_org ON "SemanticRule"("organizationId");
CREATE INDEX IF NOT EXISTS idx_semantic_eval_org ON "SemanticEvaluation"("organizationId");
CREATE INDEX IF NOT EXISTS idx_session_org ON "Session"("organizationId");
