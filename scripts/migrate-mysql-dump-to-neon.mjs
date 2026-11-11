import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const tableDelegates = {
  auditlog: 'auditLog',
  documentseries: 'documentSeries',
  user: 'user',
  rolepermission: 'rolePermission',
  loginratelimit: 'loginRateLimit',
  item: 'item',
  stocktransfer: 'stockTransfer',
  warehousestock: 'warehouseStock',
  workorder: 'workOrder',
  mrs: 'mRS',
  receiving: 'receiving',
  mrsitem: 'mRSItem',
  receivingitem: 'receivingItem',
  stockmovement: 'stockMovement',
  stocktransferitem: 'stockTransferItem',
  workorderitem: 'workOrderItem',
  purchaserequisition: 'purchaseRequisition',
  receivingattachment: 'receivingAttachment',
};
const importOrder = Object.keys(tableDelegates);
const integerFields = new Set(['failedAttempts', 'nextNumber', 'padding', 'sessionVersion']);
const booleanFields = new Set(['enabled', 'isActive', 'notInInventory']);
const dateFields = new Set([
  'blockedUntil',
  'cancelledAt',
  'createdAt',
  'dateNeeded',
  'dateRequested',
  'dateTransferred',
  'receivedDate',
  'updatedAt',
  'windowStartedAt',
]);

function mysqlDateToUtc(value) {
  const timestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return new Date(timestamp);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Environment file not found: ${filePath}`);
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function decodeMysqlString(value) {
  return value.replace(/\\(.)/gs, (_, character) => {
    const escapes = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
    return escapes[character] ?? character;
  });
}

function parseLiteral(source, state) {
  while (state.index < source.length && /\s/.test(source[state.index])) state.index++;
  if (source[state.index] === "'") {
    state.index++;
    let value = '';
    while (state.index < source.length) {
      const character = source[state.index++];
      if (character === '\\') {
        if (state.index >= source.length) throw new Error('Malformed escaped string in SQL dump.');
        value += decodeMysqlString(`\\${source[state.index++]}`);
      } else if (character === "'") {
        if (source[state.index] === "'") {
          value += "'";
          state.index++;
        } else {
          return value;
        }
      } else {
        value += character;
      }
    }
    throw new Error('Unterminated string in SQL dump.');
  }

  const start = state.index;
  while (state.index < source.length && source[state.index] !== ',' && source[state.index] !== ')') state.index++;
  const token = source.slice(start, state.index).trim();
  if (/^NULL$/i.test(token)) return null;
  if (/^(?:TRUE|FALSE)$/i.test(token)) return /^TRUE$/i.test(token);
  if (/^(?:0x|X')/i.test(token)) {
    const hex = token.replace(/^0x/i, '').replace(/^X'|^x'/, '').replace(/'$/, '');
    if (hex.length % 2 !== 0 || !/^[\da-f]*$/i.test(hex)) throw new Error('Malformed binary value in SQL dump.');
    return Buffer.from(hex, 'hex');
  }
  if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(token)) return token;
  throw new Error('Unsupported SQL value found in dump; import stopped before writing.');
}

function parseValues(source, columns) {
  const rows = [];
  const state = { index: 0 };
  while (state.index < source.length) {
    while (state.index < source.length && /[\s,]/.test(source[state.index])) state.index++;
    if (state.index >= source.length) break;
    if (source[state.index++] !== '(') throw new Error('Unexpected SQL values syntax in dump.');

    const values = [];
    while (state.index < source.length) {
      values.push(parseLiteral(source, state));
      while (state.index < source.length && /\s/.test(source[state.index])) state.index++;
      const delimiter = source[state.index++];
      if (delimiter === ')') break;
      if (delimiter !== ',') throw new Error('Unexpected SQL row delimiter in dump.');
    }
    if (values.length !== columns.length) throw new Error('SQL row has a different number of values than columns.');
    rows.push(Object.fromEntries(columns.map((column, index) => {
      let value = values[index];
      if (value !== null && integerFields.has(column)) value = Number(value);
      if (value !== null && booleanFields.has(column)) value = value === true || value === '1' || value === 1;
      if (value !== null && dateFields.has(column)) {
        value = mysqlDateToUtc(value);
        if (Number.isNaN(value.getTime())) throw new Error(`Invalid date in ${column} column of SQL dump.`);
      }
      return [column, value];
    })));
    while (state.index < source.length && /\s/.test(source[state.index])) state.index++;
    if (source[state.index] === ',') state.index++;
    else if (state.index < source.length && source[state.index] !== ';') throw new Error('Unexpected SQL values separator in dump.');
  }
  return rows;
}

function parseDump(sql) {
  const rowsByTable = new Map();
  const statements = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < sql.length; index++) {
    const character = sql[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) {
        if (sql[index + 1] === quote) index++;
        else quote = '';
      }
    } else if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === ';') {
      statements.push(sql.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < sql.length) statements.push(sql.slice(start));

  for (const statement of statements) {
    const match = statement.match(/INSERT INTO\s+`([^`]+)`\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*);\s*$/i);
    if (!match) continue;
    const table = match[1].toLowerCase();
    if (!tableDelegates[table]) throw new Error(`Unrecognized table "${table}" in SQL dump; import stopped before writing.`);
    const columns = [...match[2].matchAll(/`([^`]+)`/g)].map(column => column[1]);
    if (!columns.length) throw new Error('SQL INSERT statement has no column list.');
    const rows = parseValues(match[3], columns);
    rowsByTable.set(table, [...(rowsByTable.get(table) || []), ...rows]);
  }
  if (!rowsByTable.size) throw new Error('No supported INSERT statements found in SQL dump.');
  return rowsByTable;
}

async function main() {
  const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const argumentsList = process.argv.slice(2);
  const dryRun = argumentsList.includes('--dry-run');
  const option = name => {
    const index = argumentsList.indexOf(name);
    return index >= 0 ? argumentsList[index + 1] : undefined;
  };
  const dumpArgument = argumentsList.find(argument => !argument.startsWith('--'));
  const branch = option('--branch');
  const envFileArgument = option('--env-file');
  const dumpFile = dumpArgument ? path.resolve(dumpArgument) : '';
  if (!dumpFile || !fs.existsSync(dumpFile)) throw new Error('Pass the path to the MySQL SQL dump as the first argument.');

  const rowsByTable = parseDump(fs.readFileSync(dumpFile, 'utf8'));
  const rowCount = [...rowsByTable.values()].reduce((total, rows) => total + rows.length, 0);
  if (dryRun) {
    console.log(`Validated ${rowCount} rows across ${rowsByTable.size} populated tables in the SQL dump.`);
    for (const table of importOrder) console.log(`${table}: ${rowsByTable.get(table)?.length || 0}`);
    return;
  }

  if (!branch || !envFileArgument) throw new Error('Specify both --branch and --env-file for a database import.');
  if (branch === 'production' && !argumentsList.includes('--confirm-production-import')) {
    throw new Error('Production import requires the explicit --confirm-production-import flag.');
  }
  const envFile = path.resolve(projectDirectory, envFileArgument);
  loadEnvFile(envFile);
  if (process.env.NEON_BRANCH !== branch) throw new Error('Refusing to import: environment file branch does not match the explicitly requested target.');
  if (!process.env.DATABASE_URL) throw new Error('The Neon pooled database URL is missing.');

  const client = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const existingCounts = await Promise.all(importOrder.map(async table => {
      const delegate = client[tableDelegates[table]];
      return [table, await delegate.count()];
    }));
    const nonEmptyTables = existingCounts.filter(([, count]) => count > 0);
    if (nonEmptyTables.length) throw new Error('Refusing to import because the target branch already contains ERP records.');

    const importedCounts = new Map(importOrder.map(table => [table, rowsByTable.get(table)?.length || 0]));
    await client.$transaction(async transaction => {
      for (const table of importOrder) {
        const rows = rowsByTable.get(table) || [];
        if (rows.length) {
          try {
            await transaction[tableDelegates[table]].createMany({ data: rows });
          } catch (error) {
            if (error instanceof Error && error.name.startsWith('Prisma')) {
              throw new Error(`Prisma rejected rows for table "${table}" (${error.name}${error.code ? `, code ${error.code}` : ''}); transaction rolled back.`);
            }
            throw error;
          }
        }
      }
    }, { timeout: 120000 });

    const verifiedCounts = await Promise.all(importOrder.map(async table => {
      const delegate = client[tableDelegates[table]];
      return [table, await delegate.count()];
    }));
    const mismatches = verifiedCounts.filter(([table, count]) => count !== importedCounts.get(table));
    if (mismatches.length) throw new Error('Imported row counts do not match the SQL dump; review the migration before using this branch.');

    console.log(`Imported ${[...importedCounts.values()].reduce((total, count) => total + count, 0)} rows into ${branch}.`);
    for (const [table, count] of importedCounts) console.log(`${table}: ${count}`);
    console.log('All imported table counts verified.');
  } finally {
    await client.$disconnect();
  }
}

main().catch(error => {
  if (error instanceof Error && error.name.startsWith('Prisma')) {
    console.error(`MySQL-to-Neon import failed (${error.name}${error.code ? `, code ${error.code}` : ''}). No record values or connection strings were logged.`);
  } else {
    console.error(error instanceof Error ? error.message : 'MySQL-to-Neon import failed.');
  }
  process.exitCode = 1;
});
