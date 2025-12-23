#!/usr/bin/env node

/**
 * Guthwine CLI
 * Command-line interface for managing agents and transactions
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { GuthwineClient } from '@guthwine/sdk';

// =============================================================================
// CONFIGURATION
// =============================================================================

function getClient(): GuthwineClient {
  const baseUrl = process.env.GUTHWINE_API_URL || 'http://localhost:3000';
  const apiKey = process.env.GUTHWINE_API_KEY;

  if (!apiKey) {
    console.error(chalk.red('Error: GUTHWINE_API_KEY environment variable is required'));
    process.exit(1);
  }

  return new GuthwineClient({
    baseUrl,
    apiKey,
    timeout: 30000,
    retries: 3,
  });
}

// =============================================================================
// CLI PROGRAM
// =============================================================================

const program = new Command();

program
  .name('guthwine')
  .description('Guthwine CLI - Sovereign Governance Layer for AI Agents')
  .version('2.0.0');

// =============================================================================
// AGENT COMMANDS
// =============================================================================

const agentCmd = program.command('agent').description('Agent management commands');

agentCmd
  .command('create')
  .description('Create a new agent')
  .requiredOption('-n, --name <name>', 'Agent name')
  .option('-t, --type <type>', 'Agent type (PRIMARY, DELEGATED, SERVICE, EPHEMERAL)', 'PRIMARY')
  .option('-p, --parent <id>', 'Parent agent ID')
  .action(async (options) => {
    const spinner = ora('Creating agent...').start();
    try {
      const client = getClient();
      const result = await client.createAgent({
        name: options.name,
        type: options.type,
        parentAgentId: options.parent,
      });
      spinner.succeed('Agent created successfully');
      console.log(chalk.green('\nAgent Details:'));
      console.log(`  ID: ${result.id}`);
      console.log(`  DID: ${result.did}`);
      console.log(`  Name: ${result.name}`);
      console.log(`  Public Key: ${result.publicKey.slice(0, 50)}...`);
    } catch (error) {
      spinner.fail('Failed to create agent');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

agentCmd
  .command('get <id>')
  .description('Get agent details')
  .action(async (id) => {
    const spinner = ora('Fetching agent...').start();
    try {
      const client = getClient();
      const result = await client.getAgent(id);
      spinner.succeed('Agent retrieved');
      console.log(chalk.green('\nAgent Details:'));
      console.log(`  ID: ${result.id}`);
      console.log(`  DID: ${result.did}`);
      console.log(`  Name: ${result.name}`);
      console.log(`  Type: ${result.type}`);
      console.log(`  Status: ${result.status}`);
      console.log(`  Created: ${result.createdAt}`);
    } catch (error) {
      spinner.fail('Failed to fetch agent');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

agentCmd
  .command('freeze <id>')
  .description('Freeze an agent (kill switch)')
  .requiredOption('-r, --reason <reason>', 'Reason for freezing')
  .action(async (id, options) => {
    const spinner = ora('Freezing agent...').start();
    try {
      const client = getClient();
      await client.freezeAgent(id, options.reason);
      spinner.succeed('Agent frozen successfully');
    } catch (error) {
      spinner.fail('Failed to freeze agent');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

agentCmd
  .command('unfreeze <id>')
  .description('Unfreeze an agent')
  .action(async (id) => {
    const spinner = ora('Unfreezing agent...').start();
    try {
      const client = getClient();
      await client.unfreezeAgent(id);
      spinner.succeed('Agent unfrozen successfully');
    } catch (error) {
      spinner.fail('Failed to unfreeze agent');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// =============================================================================
// TRANSACTION COMMANDS
// =============================================================================

const txCmd = program.command('transaction').alias('tx').description('Transaction commands');

txCmd
  .command('authorize')
  .description('Authorize a transaction')
  .requiredOption('-a, --agent <did>', 'Agent DID')
  .requiredOption('-m, --amount <amount>', 'Transaction amount')
  .option('-c, --currency <currency>', 'Currency code', 'USD')
  .requiredOption('--merchant <id>', 'Merchant ID')
  .option('--merchant-name <name>', 'Merchant name')
  .option('--merchant-category <category>', 'Merchant category')
  .option('-r, --reasoning <trace>', 'Reasoning trace')
  .action(async (options) => {
    const spinner = ora('Authorizing transaction...').start();
    try {
      const client = getClient();
      const result = await client.authorizeTransaction({
        agentDid: options.agent,
        amount: parseFloat(options.amount),
        currency: options.currency,
        merchantId: options.merchant,
        merchantName: options.merchantName,
        merchantCategory: options.merchantCategory,
        reasoningTrace: options.reasoning,
      });
      
      if (result.status === 'APPROVED') {
        spinner.succeed('Transaction approved');
      } else if (result.status === 'REQUIRES_REVIEW') {
        spinner.warn('Transaction requires review');
      } else {
        spinner.fail('Transaction denied');
      }
      
      console.log(chalk.green('\nAuthorization Result:'));
      console.log(`  Transaction ID: ${result.transactionId}`);
      console.log(`  Status: ${result.status}`);
      console.log(`  Decision: ${result.decision}`);
      console.log(`  Reason: ${result.reason}`);
      console.log(`  Risk Score: ${result.riskScore}`);
      
      if (result.mandateToken) {
        console.log(`  Mandate Token: ${result.mandateToken.slice(0, 50)}...`);
        console.log(`  Expires: ${result.mandateExpiresAt}`);
      }
      
      if (result.policyViolations.length > 0) {
        console.log(`  Violations: ${result.policyViolations.join(', ')}`);
      }
    } catch (error) {
      spinner.fail('Failed to authorize transaction');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

txCmd
  .command('execute <id>')
  .description('Execute an approved transaction')
  .requiredOption('-t, --token <token>', 'Mandate token')
  .requiredOption('-r, --rail <rail>', 'Payment rail (STRIPE, COINBASE, WISE, PLAID, WEBHOOK, MANUAL)')
  .action(async (id, options) => {
    const spinner = ora('Executing transaction...').start();
    try {
      const client = getClient();
      const result = await client.executeTransaction({
        transactionId: id,
        mandateToken: options.token,
        paymentRail: options.rail,
      });
      
      if (result.success) {
        spinner.succeed('Transaction executed successfully');
        console.log(chalk.green('\nExecution Result:'));
        console.log(`  Rail Transaction ID: ${result.railTransactionId}`);
      } else {
        spinner.fail('Transaction execution failed');
        console.log(chalk.red(`\nError: ${result.error}`));
      }
    } catch (error) {
      spinner.fail('Failed to execute transaction');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// =============================================================================
// DELEGATION COMMANDS
// =============================================================================

const delegationCmd = program.command('delegation').alias('del').description('Delegation commands');

delegationCmd
  .command('create')
  .description('Create a delegation')
  .requiredOption('-i, --issuer <id>', 'Issuer agent ID')
  .requiredOption('-r, --recipient <id>', 'Recipient agent ID')
  .option('--max-amount <amount>', 'Maximum transaction amount')
  .option('--allowed-merchants <ids>', 'Comma-separated allowed merchant IDs')
  .option('--blocked-merchants <ids>', 'Comma-separated blocked merchant IDs')
  .option('--allowed-categories <categories>', 'Comma-separated allowed categories')
  .option('--semantic <constraints>', 'Semantic constraints')
  .option('--expires <seconds>', 'Expiration in seconds')
  .action(async (options) => {
    const spinner = ora('Creating delegation...').start();
    try {
      const client = getClient();
      const result = await client.createDelegation({
        issuerAgentId: options.issuer,
        recipientAgentId: options.recipient,
        constraints: {
          maxAmount: options.maxAmount ? parseFloat(options.maxAmount) : undefined,
          allowedMerchants: options.allowedMerchants?.split(','),
          blockedMerchants: options.blockedMerchants?.split(','),
          allowedCategories: options.allowedCategories?.split(','),
          semanticConstraints: options.semantic,
          expiresInSeconds: options.expires ? parseInt(options.expires) : undefined,
        },
      });
      spinner.succeed('Delegation created successfully');
      console.log(chalk.green('\nDelegation Details:'));
      console.log(`  ID: ${result.id}`);
      console.log(`  Expires: ${result.expiresAt}`);
      console.log(`  Token: ${result.token.slice(0, 100)}...`);
    } catch (error) {
      spinner.fail('Failed to create delegation');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

delegationCmd
  .command('revoke <id>')
  .description('Revoke a delegation')
  .requiredOption('-r, --reason <reason>', 'Reason for revocation')
  .action(async (id, options) => {
    const spinner = ora('Revoking delegation...').start();
    try {
      const client = getClient();
      await client.revokeDelegation(id, options.reason);
      spinner.succeed('Delegation revoked successfully');
    } catch (error) {
      spinner.fail('Failed to revoke delegation');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// =============================================================================
// POLICY COMMANDS
// =============================================================================

const policyCmd = program.command('policy').description('Policy management commands');

policyCmd
  .command('add')
  .description('Add a policy to an agent')
  .requiredOption('-a, --agent <id>', 'Agent ID')
  .requiredOption('-n, --name <name>', 'Policy name')
  .option('-d, --description <desc>', 'Policy description')
  .requiredOption('-r, --rules <json>', 'JSON Logic rules (as JSON string)')
  .option('-p, --priority <priority>', 'Policy priority')
  .action(async (options) => {
    const spinner = ora('Adding policy...').start();
    try {
      const client = getClient();
      const rules = JSON.parse(options.rules);
      const result = await client.addPolicy({
        agentId: options.agent,
        name: options.name,
        description: options.description,
        rules,
        priority: options.priority ? parseInt(options.priority) : undefined,
      });
      spinner.succeed('Policy added successfully');
      console.log(chalk.green('\nPolicy Details:'));
      console.log(`  ID: ${result.id}`);
      console.log(`  Name: ${result.name}`);
    } catch (error) {
      spinner.fail('Failed to add policy');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

policyCmd
  .command('list <agentId>')
  .description('List policies for an agent')
  .action(async (agentId) => {
    const spinner = ora('Fetching policies...').start();
    try {
      const client = getClient();
      const policies = await client.getPolicies(agentId);
      spinner.succeed(`Found ${policies.length} policies`);
      
      if (policies.length === 0) {
        console.log(chalk.yellow('\nNo policies found'));
        return;
      }
      
      console.log(chalk.green('\nPolicies:'));
      for (const policy of policies) {
        console.log(`\n  ${policy.name} (${policy.id})`);
        console.log(`    Priority: ${policy.priority}`);
        console.log(`    Active: ${policy.isActive}`);
        if (policy.description) {
          console.log(`    Description: ${policy.description}`);
        }
      }
    } catch (error) {
      spinner.fail('Failed to fetch policies');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// =============================================================================
// AUDIT COMMANDS
// =============================================================================

const auditCmd = program.command('audit').description('Audit trail commands');

auditCmd
  .command('list')
  .description('List audit log entries')
  .option('-a, --agent <id>', 'Filter by agent ID')
  .option('-t, --transaction <id>', 'Filter by transaction ID')
  .option('-l, --limit <limit>', 'Maximum entries', '50')
  .action(async (options) => {
    const spinner = ora('Fetching audit logs...').start();
    try {
      const client = getClient();
      const logs = await client.getAuditTrail({
        agentId: options.agent,
        transactionId: options.transaction,
        limit: parseInt(options.limit),
      });
      spinner.succeed(`Found ${logs.length} entries`);
      
      if (logs.length === 0) {
        console.log(chalk.yellow('\nNo audit logs found'));
        return;
      }
      
      console.log(chalk.green('\nAudit Logs:'));
      for (const log of logs) {
        console.log(`\n  [${log.timestamp}] ${log.action}`);
        console.log(`    ID: ${log.id}`);
        console.log(`    Payload: ${JSON.stringify(log.payload).slice(0, 100)}...`);
      }
    } catch (error) {
      spinner.fail('Failed to fetch audit logs');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

auditCmd
  .command('verify')
  .description('Verify audit trail integrity')
  .action(async () => {
    const spinner = ora('Verifying audit integrity...').start();
    try {
      const client = getClient();
      const result = await client.verifyAuditIntegrity();
      
      if (result.valid) {
        spinner.succeed('Audit trail integrity verified');
      } else {
        spinner.fail('Audit trail integrity check failed');
      }
      
      console.log(chalk.green('\nIntegrity Report:'));
      console.log(`  Valid: ${result.valid}`);
      console.log(`  Total Logs: ${result.totalLogs}`);
      console.log(`  Verified: ${result.verifiedLogs}`);
      
      if (result.errors.length > 0) {
        console.log(chalk.red('\nErrors:'));
        for (const error of result.errors) {
          console.log(`  - ${error}`);
        }
      }
    } catch (error) {
      spinner.fail('Failed to verify audit integrity');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// =============================================================================
// GLOBAL COMMANDS
// =============================================================================

const globalCmd = program.command('global').description('Global control commands');

globalCmd
  .command('freeze')
  .description('Activate global freeze (emergency stop)')
  .requiredOption('-r, --reason <reason>', 'Reason for freeze')
  .action(async (options) => {
    const spinner = ora('Activating global freeze...').start();
    try {
      const client = getClient();
      await client.globalFreeze(options.reason);
      spinner.succeed('Global freeze activated');
      console.log(chalk.red('\n⚠️  All agents in the organization are now frozen'));
    } catch (error) {
      spinner.fail('Failed to activate global freeze');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

globalCmd
  .command('unfreeze')
  .description('Deactivate global freeze')
  .action(async () => {
    const spinner = ora('Deactivating global freeze...').start();
    try {
      const client = getClient();
      await client.globalUnfreeze();
      spinner.succeed('Global freeze deactivated');
      console.log(chalk.green('\n✓ Agents are now active'));
    } catch (error) {
      spinner.fail('Failed to deactivate global freeze');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// =============================================================================
// RUN CLI
// =============================================================================

program.parse();
