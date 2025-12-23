#!/usr/bin/env node
/**
 * Guthwine Demo CLI
 * 
 * Zero-dependency demo that runs locally in under 10 minutes.
 * No Docker, PostgreSQL, or Redis required.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { DemoService } from './services/demo-service.js';
import { randomUUID } from 'crypto';

const program = new Command();

// ASCII Art Banner
const banner = `
${chalk.cyan('╔═══════════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('🗡️  GUTHWINE')} ${chalk.gray('- Sovereign Governance Layer for AI Agents')}   ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('    "In the hands of a worthy bearer, never fails."')}         ${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════════════════════════╝')}
`;

program
  .name('guthwine-demo')
  .description('Zero-dependency demo for Guthwine authorization system')
  .version('2.0.0');

program
  .command('start')
  .description('Start the interactive demo')
  .option('--no-semantic', 'Disable semantic firewall (faster)')
  .option('--latency <ms>', 'LLM simulation latency in ms', '800')
  .action(async (options) => {
    console.log(banner);
    
    const spinner = ora('Initializing Guthwine Demo...').start();
    
    const service = new DemoService({
      enableSemanticFirewall: options.semantic !== false,
      llmLatencyMs: parseInt(options.latency)
    });

    // Seed demo data
    spinner.text = 'Creating demo organization...';
    const org = service.createOrganization({
      name: 'Acme Corp',
      slug: 'acme-corp',
      tier: 'PROFESSIONAL'
    });

    spinner.text = 'Creating demo agents...';
    const procurementAgent = service.createAgent({
      organizationId: org.id,
      name: 'Procurement Bot',
      did: 'did:guthwine:procurement-bot-1',
      capabilities: { canTransact: true, maxAmount: 5000 }
    });

    const travelAgent = service.createAgent({
      organizationId: org.id,
      name: 'Travel Assistant',
      did: 'did:guthwine:travel-assistant-1',
      capabilities: { canTransact: true, maxAmount: 2000 }
    });

    spinner.text = 'Creating demo policies...';
    const infrastructurePolicy = service.createPolicy({
      organizationId: org.id,
      name: 'Allow Infrastructure Spending',
      effect: 'ALLOW',
      priority: 100,
      rules: {
        'or': [
          { 'in': [{ 'var': 'transaction.reason' }, ['aws', 'azure', 'cloud', 'server']] },
          { '<=': [{ 'var': 'transaction.amount' }, 1000] }
        ]
      }
    });

    const gamblingPolicy = service.createPolicy({
      organizationId: org.id,
      name: 'Block Gambling',
      effect: 'DENY',
      priority: 200,
      rules: {
        'or': [
          { 'in': ['casino', { 'var': 'transaction.reason' }] },
          { 'in': ['gambling', { 'var': 'transaction.reason' }] },
          { 'in': ['betting', { 'var': 'transaction.reason' }] }
        ]
      }
    });

    service.assignPolicyToAgent(infrastructurePolicy.id, procurementAgent.id);
    service.assignPolicyToAgent(gamblingPolicy.id, procurementAgent.id);

    spinner.succeed('Demo environment ready!');

    console.log('\n' + chalk.bold('📋 Demo Environment:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Organization: ${chalk.cyan(org.name)} (${org.id})`);
    console.log(`  Agents:`);
    console.log(`    • ${chalk.green(procurementAgent.name)} (${procurementAgent.did})`);
    console.log(`    • ${chalk.green(travelAgent.name)} (${travelAgent.did})`);
    console.log(`  Policies: ${chalk.yellow(infrastructurePolicy.name)}, ${chalk.red(gamblingPolicy.name)}`);
    console.log(chalk.gray('─'.repeat(50)));

    // Run demo scenarios
    console.log('\n' + chalk.bold('🎬 Running Demo Scenarios:'));
    console.log();

    // Scenario 1: Happy Path - AWS Credits
    await runScenario(service, {
      title: 'Scenario 1: Infrastructure Purchase (SHOULD APPROVE)',
      agentDid: procurementAgent.did,
      action: 'purchase',
      amount: 500,
      currency: 'USD',
      reason: 'AWS credits for development environment',
      expectedApproval: true
    });

    // Scenario 2: Denied - Gambling
    await runScenario(service, {
      title: 'Scenario 2: Gambling Attempt (SHOULD DENY)',
      agentDid: procurementAgent.did,
      action: 'purchase',
      amount: 100,
      currency: 'USD',
      reason: 'Online casino chips for team building',
      expectedApproval: false
    });

    // Scenario 3: Semantic Firewall - Suspicious
    await runScenario(service, {
      title: 'Scenario 3: Suspicious Request (SEMANTIC FIREWALL)',
      agentDid: travelAgent.did,
      action: 'transfer',
      amount: 5000,
      currency: 'USD',
      reason: 'URGENT wire transfer to overseas account - gift cards needed',
      expectedApproval: false
    });

    // Scenario 4: Legitimate Travel
    await runScenario(service, {
      title: 'Scenario 4: Legitimate Travel Booking (SHOULD APPROVE)',
      agentDid: travelAgent.did,
      action: 'booking',
      amount: 800,
      currency: 'USD',
      reason: 'Hotel booking for conference in San Francisco',
      expectedApproval: true
    });

    // Show stats
    console.log('\n' + chalk.bold('📊 Demo Statistics:'));
    console.log(chalk.gray('─'.repeat(50)));
    const stats = service.getStats();
    console.log(`  Agents: ${stats.db.agents}`);
    console.log(`  Policies: ${stats.db.policies}`);
    console.log(`  Transactions: ${stats.db.transactions}`);
    console.log(`  Audit Logs: ${stats.db.auditLogs}`);
    console.log(chalk.gray('─'.repeat(50)));

    // MCP Configuration
    console.log('\n' + chalk.bold('🔌 MCP Configuration for Claude Desktop:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.yellow(`
{
  "mcpServers": {
    "guthwine": {
      "command": "npx",
      "args": ["-y", "@guthwine/mcp"],
      "env": {
        "GUTHWINE_API_URL": "http://localhost:3000",
        "GUTHWINE_AGENT_DID": "${procurementAgent.did}",
        "GUTHWINE_PRIVATE_KEY": "demo-private-key-do-not-use-in-prod"
      }
    }
  }
}
`));
    console.log(chalk.gray('─'.repeat(50)));

    console.log('\n' + chalk.green.bold('✅ Demo complete!'));
    console.log(chalk.gray('Database saved to: ./guthwine_demo.db'));
    console.log(chalk.gray('Run "guthwine-demo server" to start the HTTP API.\n'));

    service.close();
  });

program
  .command('server')
  .description('Start the HTTP API server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .action(async (options) => {
    console.log(banner);
    console.log(chalk.yellow('Starting HTTP API server...'));
    console.log(chalk.gray(`Listening on http://localhost:${options.port}`));
    console.log(chalk.gray('Press Ctrl+C to stop.\n'));

    // Import and start the server
    const { startServer } = await import('./server.js');
    await startServer(parseInt(options.port));
  });

program
  .command('authorize')
  .description('Authorize a transaction')
  .requiredOption('--agent <did>', 'Agent DID')
  .requiredOption('--action <action>', 'Action to perform')
  .requiredOption('--reason <reason>', 'Reason for the transaction')
  .option('--amount <amount>', 'Transaction amount')
  .option('--currency <currency>', 'Currency code', 'USD')
  .action(async (options) => {
    const spinner = ora('Authorizing transaction...').start();
    
    const service = new DemoService();
    
    try {
      const result = await service.authorize({
        agentDid: options.agent,
        action: options.action,
        reason: options.reason,
        amount: options.amount ? parseFloat(options.amount) : undefined,
        currency: options.currency
      });

      spinner.stop();

      if (result.approved) {
        console.log(chalk.green.bold('✅ APPROVED'));
        console.log(chalk.gray('Transaction ID:'), result.transactionId);
        console.log(chalk.gray('Mandate Token:'), result.mandateToken?.substring(0, 50) + '...');
        console.log(chalk.gray('Risk Score:'), result.riskScore);
      } else {
        console.log(chalk.red.bold('❌ DENIED'));
        console.log(chalk.gray('Reason:'), result.denialReason);
        console.log(chalk.gray('Risk Score:'), result.riskScore);
      }
    } catch (error) {
      spinner.fail('Authorization failed');
      console.error(chalk.red((error as Error).message));
    }

    service.close();
  });

program
  .command('reset')
  .description('Reset the demo database')
  .action(() => {
    const spinner = ora('Resetting database...').start();
    const service = new DemoService();
    service.reset();
    service.close();
    spinner.succeed('Database reset complete!');
  });

async function runScenario(service: DemoService, scenario: {
  title: string;
  agentDid: string;
  action: string;
  amount: number;
  currency: string;
  reason: string;
  expectedApproval: boolean;
}): Promise<void> {
  console.log(chalk.bold(scenario.title));
  console.log(chalk.gray(`  Agent: ${scenario.agentDid}`));
  console.log(chalk.gray(`  Action: ${scenario.action}`));
  console.log(chalk.gray(`  Amount: ${scenario.currency} ${scenario.amount}`));
  console.log(chalk.gray(`  Reason: "${scenario.reason}"`));

  const spinner = ora('  Evaluating...').start();

  try {
    const result = await service.authorize({
      agentDid: scenario.agentDid,
      action: scenario.action,
      amount: scenario.amount,
      currency: scenario.currency,
      reason: scenario.reason
    });

    if (result.approved) {
      spinner.succeed(chalk.green('  APPROVED'));
      console.log(chalk.gray(`    Risk Score: ${result.riskScore}/100`));
      if (result.policyEvaluation.semanticAnalysis) {
        console.log(chalk.gray(`    Category: ${result.policyEvaluation.semanticAnalysis.category}`));
      }
    } else {
      spinner.fail(chalk.red('  DENIED'));
      console.log(chalk.gray(`    Reason: ${result.denialReason}`));
      console.log(chalk.gray(`    Risk Score: ${result.riskScore}/100`));
    }

    // Verify expected outcome
    if (result.approved !== scenario.expectedApproval) {
      console.log(chalk.yellow(`    ⚠️  Unexpected outcome (expected ${scenario.expectedApproval ? 'APPROVE' : 'DENY'})`));
    }
  } catch (error) {
    spinner.fail(chalk.red(`  ERROR: ${(error as Error).message}`));
  }

  console.log();
}

program.parse();
