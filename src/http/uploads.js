'use strict';
// A multipart upload on /api/v1: one file field and the text fields beside it, held in memory (the route hands the bytes
// on; nothing is written to disk here). What goes wrong with an upload is the caller's to be told, in the one error shape.

const { fail } = require('./errors');

/**
 * @param {any} multer  the multer module (the server has it on the context; it ships no types)
 * @param {{ field: string, maxBytes: number }} options
 * @returns {import('express').RequestHandler}
 */
function fileUpload(multer, { field, maxBytes }) {
  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes } }).single(
    field,
  );
  return function fileUpload(req, res, next) {
    parse(req, res, (/** @type {any} */ err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE')
        return void fail(
          res,
          413,
          'too_large',
          `The file is larger than ${Math.round(maxBytes / 1048576)} MB.`,
        );
      fail(res, 400, 'invalid', 'The request is not a valid upload.');
    });
  };
}

module.exports = { fileUpload };
