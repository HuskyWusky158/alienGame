#!/usr/bin/env node

import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, '..');
const DEFAULT_CONFIG_PATH = path.join(SCRIPT_DIRECTORY, 'performance-budgets.json');
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const CSS_EXTENSIONS = new Set(['.css']);

function parseArguments(argv) {
  const result = { configPath: DEFAULT_CONFIG_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--config') {
      if (!argv[index + 1]) throw new Error('--config requires a path');
      result.configPath = path.resolve(PROJECT_DIRECTORY, argv[index + 1]);
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return result;
}

function printHelp() {
  console.log(`Usage: node scripts/check-performance-budgets.mjs [--config path]

Checks the built files in the configured buildDirectory. Run the production
build first, or use npm run perf:check to build and check in one command.`);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Configuration not found: ${filePath}`);
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

function validateConfig(config) {
  if (config.schemaVersion !== 1) throw new Error('Only performance budget schemaVersion 1 is supported');
  if (typeof config.buildDirectory !== 'string' || config.buildDirectory.length === 0) {
    throw new Error('buildDirectory must be a non-empty string');
  }
  for (const groupName of ['limits', 'targets']) {
    const group = config[groupName] ?? {};
    if (typeof group !== 'object' || Array.isArray(group)) throw new Error(`${groupName} must be an object`);
    for (const [name, value] of Object.entries(group)) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`${groupName}.${name} must be a non-negative number`);
    }
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
  }));
  return nested.flat();
}

function localAssetPath(reference, sourcePath, buildDirectory) {
  if (!reference || /^(?:[a-z]+:)?\/\//i.test(reference) || reference.startsWith('data:')) return null;
  const withoutQuery = reference.split(/[?#]/, 1)[0];
  if (!withoutQuery) return null;
  return withoutQuery.startsWith('/')
    ? path.join(buildDirectory, withoutQuery.slice(1))
    : path.resolve(path.dirname(sourcePath), withoutQuery);
}

async function findInitialJavaScript(indexPath, buildDirectory, knownFiles) {
  const html = await readFile(indexPath, 'utf8');
  const queue = [];
  const initialFiles = new Set();
  const scriptPattern = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = scriptPattern.exec(html))) {
    const scriptPath = localAssetPath(match[1], indexPath, buildDirectory);
    if (scriptPath && knownFiles.has(scriptPath)) queue.push(scriptPath);
  }

  const staticImportPattern = /\b(?:import|export)\s*(?:[\w*{},\s$]+\s+from\s*)?["']([^"']+)["']/g;
  while (queue.length > 0) {
    const filePath = queue.pop();
    if (initialFiles.has(filePath)) continue;
    initialFiles.add(filePath);
    const source = await readFile(filePath, 'utf8');
    staticImportPattern.lastIndex = 0;
    while ((match = staticImportPattern.exec(source))) {
      const dependencyPath = localAssetPath(match[1], filePath, buildDirectory);
      if (dependencyPath && knownFiles.has(dependencyPath) && !initialFiles.has(dependencyPath)) {
        queue.push(dependencyPath);
      }
    }
  }
  return initialFiles;
}

function sum(records, field) {
  return records.reduce((total, record) => total + record[field], 0);
}

function max(records, field) {
  return records.length === 0 ? 0 : Math.max(...records.map((record) => record[field]));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function reportCheck(label, actual, limit, kind) {
  const passes = actual <= limit;
  const marker = kind === 'target' ? (passes ? 'TARGET' : 'GOAL') : (passes ? 'PASS' : 'FAIL');
  console.log(`${marker.padEnd(6)} ${label.padEnd(34)} ${formatBytes(actual).padStart(11)} / ${formatBytes(limit)}`);
  return passes;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.help) {
    printHelp();
    return;
  }

  const config = await readJson(arguments_.configPath);
  validateConfig(config);
  const buildDirectory = path.resolve(PROJECT_DIRECTORY, config.buildDirectory);
  let filePaths;
  try {
    filePaths = await listFiles(buildDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Build directory not found: ${buildDirectory}. Run npm run build first.`);
    }
    throw error;
  }
  const knownFiles = new Set(filePaths);
  const records = await Promise.all(filePaths.map(async (filePath) => {
    const data = await readFile(filePath);
    return {
      filePath,
      extension: path.extname(filePath).toLowerCase(),
      bytes: data.byteLength,
      gzipBytes: gzipSync(data).byteLength,
    };
  }));
  const javascript = records.filter((record) => JAVASCRIPT_EXTENSIONS.has(record.extension));
  const css = records.filter((record) => CSS_EXTENSIONS.has(record.extension));
  const initialPaths = await findInitialJavaScript(path.join(buildDirectory, 'index.html'), buildDirectory, knownFiles);
  const initialJavaScript = javascript.filter((record) => initialPaths.has(record.filePath));
  const metrics = {
    largestJavaScriptBytes: max(javascript, 'bytes'),
    largestJavaScriptGzipBytes: max(javascript, 'gzipBytes'),
    initialJavaScriptGzipBytes: sum(initialJavaScript, 'gzipBytes'),
    totalJavaScriptGzipBytes: sum(javascript, 'gzipBytes'),
    totalCssGzipBytes: sum(css, 'gzipBytes'),
    totalBuildGzipBytes: sum(records, 'gzipBytes'),
  };

  console.log(`Performance budgets: ${path.relative(PROJECT_DIRECTORY, arguments_.configPath)}`);
  console.log(`Build: ${path.relative(PROJECT_DIRECTORY, buildDirectory)} (${records.length} files)`);
  for (const record of javascript.sort((left, right) => right.gzipBytes - left.gzipBytes)) {
    const initialMarker = initialPaths.has(record.filePath) ? ' [initial]' : '';
    console.log(`  JS ${path.relative(buildDirectory, record.filePath)}: ${formatBytes(record.bytes)} raw, ${formatBytes(record.gzipBytes)} gzip${initialMarker}`);
  }
  console.log('');

  let failed = false;
  for (const [name, limit] of Object.entries(config.limits ?? {})) {
    if (!(name in metrics)) throw new Error(`Unknown limit metric: ${name}`);
    if (!reportCheck(name, metrics[name], limit, 'limit')) failed = true;
  }
  for (const [name, target] of Object.entries(config.targets ?? {})) {
    if (!(name in metrics)) throw new Error(`Unknown target metric: ${name}`);
    reportCheck(name, metrics[name], target, 'target');
  }
  if (failed) {
    console.error('\nPerformance budget exceeded. Update the app or intentionally revise scripts/performance-budgets.json.');
    process.exitCode = 1;
  } else {
    console.log('\nAll enforced production bundle budgets passed.');
  }
}

main().catch((error) => {
  console.error(`Performance budget check failed: ${error.message}`);
  process.exitCode = 2;
});
