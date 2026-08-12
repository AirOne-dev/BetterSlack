import test from 'node:test';
import assert from 'node:assert/strict';
import { themeChecks } from '../../../tests/theme.mjs';

themeChecks(test, assert, import.meta.url);
