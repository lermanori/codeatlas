#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { handleInit } from './commands/init.js';
import { handleAddModule } from './commands/addModule.js';
import { handleScan } from './commands/scan.js';
import { handleDev } from './commands/dev.js';



// Configure yargs
yargs(hideBin(process.argv))
  .scriptName('ai-docs')
  .version('0.1.0')
  .command(
    'init',
    'Initialize CodeAtlas documentation structure',
    (yargs) => {
      return yargs
        .option('cursor', {
          type: 'boolean',
          description: 'Install Cursor rule template',
          default: false
        });
    },
    async (argv) => {
      await handleInit({ cursor: argv.cursor as boolean });
    }
  )
  .command(
    'add-module',
    'Add a new module to the documentation',
    (yargs) => {
      return yargs;
    },
    async (argv) => {
      await handleAddModule({});
    }
  )
  .command(
    'scan',
    'Scan documentation and build ai-tree.json',
    (yargs) => {
      return yargs
        .option('analyze-code', {
          type: 'boolean',
          description: 'Enable code structure analysis',
          default: true
        })
        .option('suggest-only', {
          type: 'boolean',
          description: 'Only suggest changes, don\'t modify tree',
          default: false
        })
        .option('auto-link', {
          type: 'boolean',
          description: 'Automatically create virtual entries for source files',
          default: true
        });
    },
    async (argv) => {
      await handleScan({
        analyzeCode: argv['analyze-code'] as boolean,
        suggestOnly: argv['suggest-only'] as boolean,
        autoLink: argv['auto-link'] as boolean
      });
    }
  )
  .command(
    'dev',
    'Start the documentation viewer server',
    (yargs) => {
      return yargs
        .option('port', {
          type: 'number',
          description: 'Port to run the server on',
          default: 8765
        });
    },
    async (argv) => {
      await handleDev({ port: argv.port as number });
    }
  )
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .parse();

