'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const stage = text => fs.writeFileSync(path.join(root, 'node-stage.txt'), text);
const fail = error => {
  fs.writeFileSync(path.join(root, 'node-error.txt'), String(error?.stack || error));
  process.exitCode = 1;
};
try {
  stage('JavaScript 已运行：' + process.version);
  process.chdir(root);
  process.on('uncaughtException', error => { fail(error); process.exit(1); });
  process.on('unhandledRejection', error => { fail(error); process.exit(1); });
  stage('加载业务模块：' + process.version);
  require('./main.cjs');
} catch (error) { fail(error); }
