'use strict';
// What /api/v1 says when it says no: one shape, { error, code, issues? } — `error` is words for a person, `code` a
// word for a program (contracts: schemas.ApiError). A database's own message is never one of them: it is logged by whoever
// caught it and the caller is told only that the thing is unavailable.

const express = require('express');

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} error
 * @param {{ issues?: { path: string, message: string }[] }} [extra]
 */
function fail(res, status, code, error, extra) {
  res.status(status).json({ error, code, ...extra });
}

/**
 * A zod error as the wire has it.
 * @param {{ issues: { path: PropertyKey[], message: string }[] }} zodError
 * @returns {{ path: string, message: string }[]}
 */
function issuesOf(zodError) {
  return zodError.issues.map(i => ({ path: i.path.map(String).join('.'), message: i.message }));
}

/**
 * A body that is not JSON, or is too large, is the caller's mistake and is answered as one. Anything else goes on to
 * Express's own handler.
 * @type {import('express').ErrorRequestHandler}
 */
function v1Errors(err, _req, res, next) {
  if (err && err.type === 'entity.parse.failed')
    return void fail(res, 400, 'invalid', 'The request body is not a valid JSON object.');
  if (err && err.type === 'entity.too.large')
    return void fail(res, 413, 'too_large', 'The request body is too large.');
  next(err);
}

/**
 * The JSON body parser for a v1 route that takes a body. It answers a body it cannot read itself, in the v1 shape,
 * so the route's chain stays what the inventory shows: its guards, then its handler.
 * @returns {import('express').RequestHandler}
 */
function jsonBody() {
  const parse = express.json();
  return function jsonBody(req, res, next) {
    parse(req, res, err => (err ? v1Errors(err, req, res, next) : next()));
  };
}

module.exports = { fail, issuesOf, jsonBody };
