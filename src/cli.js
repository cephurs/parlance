// ✊🏿

'use strict';

const Base = require('./base');
const Out = require('./output');
const Client = require('./client');
const Arguments = require('./arguments');
const Credentials = require('./credentials');

/**
  The command-line interface to Parlaid.
  @extends Base
**/
const CLI = class extends Base {

  constructor (_options) {

    super(_options);

    this._out = new Out.Node();
    this._args = new Arguments();
  }

  async run () {

    let profile = {}, config = {};
    let args = this._args.parse();

    if (args.n) {
      this._out.warn('Use --confirm-no-delay if you wish to disable delays');
    }

    if (args.p != null) {
      this._out.warn('Use --confirm-page-size to truly change the page size');
    }

    if (args.n || args.p != null) {
      this._out.warn('You are responsible for deciding if this is allowed');
      this._out.warn('The authors bear no responsibility for your actions');
      this._out.fatal('You have been warned; refusing to continue as-is');
    }

    if (args.g <= 0) {
      this._out.fatal('Page size must be greater than zero');
    }

    if (args._[0] === 'init') {
      config.mst = args.mst; config.jst = args.jst;
    } else {
      try {
        let json_config = await this._out.read_file(args.c);
        config = JSON.parse(json_config);
      } catch (_e) {
        this._out.fatal(`Unable to read authorization data from ${args.c}`, 2);
      }
    }

    let credentials = new Credentials(config.mst, config.jst);

    let client = new Client(credentials, {
      page_size: args.g,
      ignore_last: !!args.i,
      credentials_output: args.o,
      disable_rng_delay: !!args.x,
      log_level: this._compute_log_level(args)
    });

    /* Be human-friendly */
    let wrote_credentials = false;
    let mst = decodeURIComponent(config.mst);
    let jst = decodeURIComponent(config.jst);

    if (config.mst !== mst || config.jst !== jst) {
      this._out.warn('Detected invalid URI-encoded credentials; correcting');
      client.credentials.mst = mst; client.credentials.jst = jst;
      client.session.write_credentials();
      wrote_credentials = true;
    }

    /* Command dispatch */
    switch (args._[0]) {

      case 'init':
        if (!args.o) {
          this._out.fatal('Refusing to continue without an output file');
        }
        if (!wrote_credentials) {
          client.session.write_credentials();
        }
        break;

      case 'profile':
        await client.profile(args.u, true);
        break;

      case 'feed':
        profile = await client.profile();
        await client.print_feed(profile);
        break;

      case 'post':
        await client.post(args.i, true);
        break;

      case 'posts':
        profile = await client.profile(args.u);
        await client.print_posts(profile);
        break;

      case 'echoes':
        profile = await client.profile(args.u);
        await client.print_echoes(profile);
        break;

      case 'comments':
        if (args.i) {
          await this._ensure_post_exists(client, args.i); /* Yikes */
          await client.print_post_comments(args.i);
        } else if (args.r) {
          profile = await client.profile();
          await client.print_comment_replies(profile, args.r);
        } else {
          profile = await client.profile(args.u);
          await client.print_user_comments(profile);
        }
        break;

      case 'following':
        profile = await client.profile(args.u);
        await client.print_following(profile);
        break;

      case 'followers':
        profile = await client.profile(args.u);
        await client.print_followers(profile);
        break;

      case 'tag':
        profile = await client.profile(args.u);
        await client.print_tag({ tag: args.t });
        break;

      case 'votes':
        profile = await client.profile(args.u);
        await client.print_votes(profile);
        break;

      case 'write':
        profile = await client.profile();
        await client.write_post(profile, args.t, true);
        break;

      case 'delete':
        profile = await client.profile(); /* For referrer */
        await this._ensure_post_exists(client, args.i); /* Yikes */
        await client.delete_post(profile, args.i, true);
        break;

      default:
        this._args.usage();
        this._out.exit(1);
        break;
    }
  }

  async _ensure_post_exists (_client, _id) {

    try {
      await _client.post(_id);
    } catch (_e) {
      this._out.fatal(_e.message);
    }
  }

  _compute_log_level (_args) {

    if (_args.s) {
      return -1;
    }

    if (_args.q) {
      return 0;
    }

    if (_args.v) {
      return 2;
    }

    return 1;
  }
};

/* Export symbols */
module.exports = CLI;

