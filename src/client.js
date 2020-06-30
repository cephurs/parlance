// ✊🏿

'use strict';

const Base = require('./base');
const Out = require('./output');
const Session = require('./session');
const Credentials = require('./session');
const Ratelimit = require('./ratelimit');
const bent = require('bent'); /* Get bent */
const ISO8601X = require('./iso8601x'); /* It's time */

/**
  The core HTTPS client implementation.
  @extends Base
**/
const Client = class extends Base {

  constructor (_credentials, _options) {

    super(_options);

    this._log_level = (this.options.log_level || 1);
    this._out = (this.options.output || new Out.Default());

    this._page_size_override = (
      this.options.page_size ?
        parseInt(_options.page_size, 10) : 10
    );

    this._credentials = _credentials;
    this._page_size_temporarily_disabled = false;
    this._ignore_last = !!this.options.ignore_last;
    this._url = (this.options.url || 'https://api.parler.com/');

    this._ua = (
      this.options.ua || [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'AppleWebKit/537.36 (KHTML, like Gecko)',
        'Chrome/83.0.4103.116',
        'Safari/537.36'
      ].join(' ')
    );

    this._session = new Session(this.credentials, null, {
      log_level: this.log_level
    });

    this._ratelimit = new Ratelimit(null, {
      log_level: this.log_level,
      disable_rng_delay: !!this.options.disable_rng_delay
    });

    return this;
  }

  get credentials () {

    return this._credentials;
  }

  get log_level () {

    return this._log_level;
  }

  get user_agent () {

    return this._ua;
  }

  get base_url () {

    return this._url;
  }

  get page_size () {

    return (this._page_size_override || this._page_size);
  }

  get log_level () {

    return this._log_level;
  }

  set page_size (_page_size) {

    if (this._page_size_override) {
      return this;
    }

    let page_size = parseInt(_page_size, 10);
    this._page_size = (page_size > 0 ? page_size : this._page_size);

    return this;
  }

  /** HTTPS functions **/

  _create_client (_headers, _method) {

    let headers = (_headers || {});
    let method = (_method || 'GET');

    let mst = encodeURIComponent(this._credentials.mst);
    let jst = encodeURIComponent(this._credentials.jst);

    headers = Object.assign(_headers, {
      'User-Agent': this.user_agent,
      'Origin': 'https://parler.com',
      'Cookie': `jst=${jst}; mst=${mst}`
    });

    return bent(this.base_url, method, null, 200, headers);
  }

  _create_extra_headers (_username) {

    if (!_username) {
      return {};
    }

    let username = encodeURIComponent(_username);

    return {
      'Accept-Language': 'en-us',
      Referrer: `https://parler.com/profile/${username}/posts`
    }
  }

  /** Result output functions **/

  _start_json_results () {

    this._out.stdout("[\n");
    return true;
  }

  _end_json_results () {

    this._out.stdout("\n]\n");
    return true;
  }

  _print_json_results (_results, _is_first_page, _is_final_page) {

    if (_results.length <= 0) {
      return true;
    }

    for (let i = 0, len = _results.length; i < len; ++i) {

      if (!(_is_first_page && i <= 0)) {
        this._out.stdout(",");
      }
      this._out.stdout(
        JSON.stringify(_results[i]).trim()
      );
    }

    return true;
  }

  /** Paging **/

  _temporarily_disable_page_size () {

    this._page_size_temporarily_disabled = true;
    return this;
  }

  async _paged_request (_profile, _request_callback, _reduce_callback,
                        _result_callback, _start_callback, _end_callback) {

    /* To do:
        This paging logic could be pulled out into a buffered iterator. */

    let record = {};
    let results = [];
    let is_first_page = true;
    let prev_key = null, next_key = null;

    if (!_request_callback) {
      throw new Error('Request callback required');
    }

    let end_cb = (_end_callback || this._end_json_results.bind(this));
    let start_cb = (_start_callback || this._start_json_results.bind(this));
    let result_cb = (_result_callback || this._print_json_results.bind(this));

    if (!start_cb()) {
      throw new Error('Result dispatch: start failed');
    }

    for (;;) {

      let key_comparison = 0;

      /* Perform actual network request */
      let record = await _request_callback(_profile, next_key);
      next_key = record.next;

      /* Extract result array */
      results = _reduce_callback(record);

      /* Enforce monotonicity */
      if (!is_first_page) {
        try {
          key_comparison = ISO8601X.compare_extended(
            ISO8601X.parse_extended(prev_key),
              ISO8601X.parse_extended(next_key),
          );
        } catch (_e) {
          throw new Error('Invalid or corrupt time-series key');
        }
      }

      /* Exit conditions */
      let is_final_page = (
        !is_first_page && key_comparison > 0 &&
          (this._ignore_last ? false : record.last == true)
      );

      /* Additional exit condition */
      if (!results.length) {
        is_final_page = true;
      }

      /* Dispatch result */
      if (!result_cb(results, is_first_page, is_final_page)) {
        throw new Error('Result dispatch failed');
      }

      is_first_page = false;
      prev_key = next_key;

      /* Termination */
      if (is_final_page) {
        break;
      }
    }

    /* Some APIs don't use the limit parameter */
    this._page_size_temporarily_disabled = false;

    if (!end_cb()) {
      throw new Error('Result dispatch: completion failed');
    }

    if (this.log_level > 0) {
      this._out.log('success', 'Finished fetching paged results');
    }

    return true;
  }

  async _paged_request_one (_url, _profile, _start_key, _url_callback) {

    let url = _url.slice(); /* Clone */

    let request = this._create_client(
      this._create_extra_headers(_profile.username)
    );

    let url_callback = (
      _url_callback || ((_p) => {
        return (_p._id ? `id=${encodeURIComponent(_p._id)}` : null);
      })
    );

    let qs = (url_callback(_profile || {}) || '');

    /* Some APIs don't use the limit parameter */
    if (!this._page_size_temporarily_disabled) {
      qs = `${qs}&limit=${encodeURIComponent(this.page_size)}`;
    }

    if (_start_key) {
      qs += `&startkey=${encodeURIComponent(_start_key)}`;
    }

    if (qs) {
      url = `${_url}?${qs}`;
    }

    if (this.log_level > 0) {
      this._out.log_network(url);
    }

    /* Issue actual HTTPS request */
    let rv = await request(url);
    this._session.headers = rv.headers;
    this._ratelimit.headers = rv.headers;

    /* Minimize impact on service */
    await this._ratelimit.wait();

    /* Finished */
    return rv;
  }

  /** Paged API request callbacks **/

  async _request_feed (_profile, _start_ts) {

    const response = await this._paged_request_one(
      'v1/feed', _profile, _start_ts, () => null
    );

    return await response.json();
  }

  async _request_creator (_profile, _start_ts) {

    const response = await this._paged_request_one(
      'v1/post/creator', _profile, _start_ts
    );

    return await response.json();
  }

  async _request_following (_profile, _start_ts) {

    const response = await this._paged_request_one(
      'v1/follow/following', _profile, _start_ts
    );

    return await response.json();
  }

  async _request_followers (_profile, _start_ts) {

    const response = await this._paged_request_one(
      'v1/follow/followers', _profile, _start_ts
    );

    return await response.json();
  }

  async _request_user_comments (_profile, _start_ts) {

    const response = await this._paged_request_one(
      'v1/comment/creator', _profile, _start_ts, (_profile) => {
        return `username=${encodeURIComponent(_profile.username)}`;
      }
    );

    return await response.json();
  }

  async _request_post_comments (_profile, _start_ts) {

    const response = await this._paged_request_one(
      'v1/comment', _profile, _start_ts, (_profile) => {
        return `id=${encodeURIComponent(_profile._id)}&reverse=true`;
      }
    );

    return await response.json();
  }

  async _request_votes (_profile, _start_ts) {

    const response = await this._paged_request_one(
      'v1/post/creator/liked', _profile, _start_ts
    );

    return await response.json();
  }

  async _print_generic (_profile, _fn_name, _key) {

    return await this._paged_request(
      _profile, this[_fn_name].bind(this), (_o) => (_o[_key] || [])
    );
  }

  /** API endpoints **/

  async profile (_username, _print_results) {

    let request = this._create_client(
      this._create_extra_headers(_username)
    );

    let url = `v1/profile`;

    if (_username) {
      url = `${url}?username=${encodeURIComponent(username)}`;
    }

    if (this.log_level > 0) {
      this._out.log_network(url);
    }

    await this._ratelimit.wait();

    /* HTTPS request */
    const r = await request(url);
    const rv = await r.json();

    /* Optionally print results */
    if (_print_results) {
      this._start_json_results();
      this._print_json_results([ rv ], true);
      this._end_json_results();
    }

    return rv;
  }

  async post (_profile, _text, _print_results) {

    let body = {
      body: _text,
      parent: null, links: [], state: 4
    }

    let request = this._create_client(
      this._create_extra_headers(_profile.username), 'POST'
    );

    const r = await request('v1/post', body);
    const rv = await r.json();

    /* Optionally print results */
    if (_print_results) {
      this._start_json_results();
      this._print_json_results([ rv ], true);
      this._end_json_results();
    }

    return rv;
  }

  async delete (_profile, _id, _print_results) {

    let body = { id: _id };

    let request = this._create_client(
      this._create_extra_headers(_profile.username), 'POST'
    );

    const r = await request('v1/post/delete', body);
    const rv = await r.json();

    /* Optionally print results */
    if (_print_results) {
      this._start_json_results();
      this._print_json_results([ rv ], true);
      this._end_json_results();
    }

    return rv;
  }
  async print_feed () {

    this.page_size = 10;
    return this._print_generic(
      null, '_request_feed', 'posts'
    );
  }

  async print_feed_echoes () {

    this.page_size = 10;
    return this._print_generic(
      null, '_request_feed', 'postRefs'
    );
  }

  async print_posts (_profile) {

    this.page_size = 20;
    return this._print_generic(
      _profile, '_request_creator', 'posts'
    );
  }

  async print_echoes (_profile) {

    this.page_size = 20;
    return this._print_generic(
      _profile, '_request_creator', 'postRefs'
    );
  }

  async print_following (_profile) {

    this.page_size = 10;
    return this._print_generic(
      _profile, '_request_following', 'followees'
    );
  }

  async print_followers (_profile) {

    this.page_size = 10;
    return this._print_generic(
      _profile, '_request_followers', 'followers'
    );
  }

  async print_user_comments (_profile) {

    this.page_size = 10;
    return this._print_generic(
      _profile, '_request_user_comments', 'comments'
    );
  }

  async print_post_comments (_id) {

    this.page_size = 10;
    this._temporarily_disable_page_size(); /* They do this */

    return this._print_generic(
      { _id: _id }, '_request_post_comments', 'comments'
    );
  }

  async print_votes (_profile) {

    this.page_size = 10;
    return this._print_generic(
      _profile, '_request_votes', 'posts'
    );
  }
};

/* Export symbols */
module.exports = Client;

