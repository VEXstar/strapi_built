'use strict';

const fs = require('fs');
const path = require('path');
const stream = require('stream');
const _ = require('lodash');
const { defaultsDeep } = require('lodash/fp');
const koaStatic = require('koa-static');
const utils = require('../../utils');
const serveStatic = require('./serve-static');

const defaults = {
  maxAge: 60000,
  defaultIndex: true,
};

/**
 * @type {import('../').MiddlewareFactory}
 */
module.exports = (config, { strapi }) => {
  const { defaultIndex, maxAge } = defaultsDeep(defaults, config);

  if (defaultIndex === true) {
    const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    const serveIndexPage = async (ctx, next) => {
      // defer rendering of strapi index page
      await next();

      if (ctx.body != null || ctx.status !== 404) return;

      ctx.url = 'index.html';
      const isInitialized = await utils.isInitialized(strapi);
      const data = {
        serverTime: new Date().toUTCString(),
        isInitialized,
        ..._.pick(strapi, [
          'config.info.version',
          'config.info.name',
          'config.admin.url',
          'config.server.url',
          'config.environment',
          'config.serveAdminPanel',
        ]),
      };
      const content = _.template(index)(data);
      const body = stream.Readable({
        read() {
          this.push(Buffer.from(content));
          this.push(null);
        },
      });
      // Serve static.
      ctx.type = 'html';
      ctx.body = body;
    };

    strapi.server.routes([
      {
        method: 'GET',
        path: '/',
        handler: serveIndexPage,
        config: { auth: false },
      },
      {
        method: 'GET',
        path: '/index.html',
        handler: serveIndexPage,
        config: { auth: false },
      },
      {
        method: 'GET',
        path: '/assets/images/(.*)',
        handler: serveStatic(path.resolve(__dirname, 'assets/images'), {
          maxage: maxAge,
          defer: true,
        }),
        config: { auth: false },
      },
      {
        method: 'GET',
        path: '/(.*)',
        handler: koaStatic(strapi.dirs.public, {
          maxage: maxAge,
          defer: true,
        }),
        config: { auth: false },
      },
    ]);
  }

  if (!strapi.config.serveAdminPanel) return async (ctx, next) => next();

  const buildDir = path.resolve(strapi.dirs.root, 'build');
  const serveAdmin = async (ctx, next) => {
    await next();

    if (ctx.method !== 'HEAD' && ctx.method !== 'GET') {
      return;
    }

    if (ctx.body != null || ctx.status !== 404) {
      return;
    }

    ctx.type = 'html';
    ctx.body = fs.createReadStream(path.join(buildDir + '/index.html'));
  };

  strapi.server.routes([
    {
      method: 'GET',
      path: `${strapi.config.admin.path}/:path*`,
      handler: [
        serveAdmin,
        serveStatic(buildDir, { maxage: maxAge, defer: false, index: 'index.html' }),
      ],
      config: { auth: false },
    },
  ]);

  return null;
};
