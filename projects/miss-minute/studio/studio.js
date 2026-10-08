/* ═══════════════════════════════════════════════════════════════
   MISS MINUTES STUDIO v2 — Script Engine
   Modern scripting language with: variables, loops, if/elif/else,
   sequences, together (parallel), wait, break/continue/end,
   full audio control, and syntax highlighting.
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ── Wait for engine to be ready ──────────────────────────────────
  function waitForEngine(cb) {
    if (window.MissMinutes && window.__studio) return cb();
    setTimeout(() => waitForEngine(cb), 80);
  }
  waitForEngine(main);

  function main() {

    // ── Engine / DOM references ──────────────────────────────────────
    const S   = window.__studio || {};   // exposed by script.js
    const M   = window.MissMinutes;      // high-level API
    const ENG = S.engine  || {};         // raw engine internals
    const AU  = S.audio   || { el: new Audio(), files: new Map(),
      stop(){ this.el.pause(); this.el.currentTime=0; },
      play(){ return this.el.play(); },
      load(f){ const u=this.files?.get(f); if(u) this.el.src=u; } };

    const EXPRESSIONS = S.EXPRESSIONS || {};
    const MOVES       = S.MOVES       || {};
    const FXG         = S.FXG         || {};
    const BG          = S.BG          || {};

    const $ = id => document.getElementById(id);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmtT = s => {
      if (!isFinite(s) || s < 0) return '0:00.00';
      const m = Math.floor(s / 60), sec = s % 60;
      return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
    };

    // ══════════════════════════════════════════════════════════════════
    // TOKENIZER
    // ══════════════════════════════════════════════════════════════════

    const TT = {
      NUM: 'NUM', STR: 'STR', WORD: 'WORD', VAR: 'VAR',
      OP: 'OP', LB: 'LB', RB: 'RB', LP: 'LP', RP: 'RP',
      NL: 'NL', CMT: 'CMT', EOF: 'EOF'
    };

    function tokenize(src) {
      const toks = [];
      let i = 0, ln = 1, col = 1;

      const ch = () => src[i] ?? '';
      const ch1 = () => src[i + 1] ?? '';
      const adv = () => { const c = src[i++]; c === '\n' ? (ln++, col = 1) : col++; return c; };
      const tok = (t, v, l = ln, c = col) => toks.push({ t, v, ln: l, col: c });

      while (i < src.length) {
        const l = ln, c = col, x = ch();

        // Whitespace (not newline)
        if (x === ' ' || x === '\t' || x === '\r') { adv(); continue; }

        // Newline
        if (x === '\n') { adv(); tok(TT.NL, '\n', l, c); continue; }

        // Line comments  # …  or  // …
        if (x === '#' || (x === '/' && ch1() === '/')) {
          let s = ''; while (i < src.length && ch() !== '\n') s += adv();
          tok(TT.CMT, s, l, c); continue;
        }

        // Strings  "…"  '…'
        if (x === '"' || x === "'") {
          const q = adv(); let s = '';
          while (i < src.length && ch() !== q && ch() !== '\n') {
            if (ch() === '\\') { adv(); const e = adv(); s += e === 'n' ? '\n' : e === 't' ? '\t' : e; }
            else s += adv();
          }
          if (ch() === q) adv();
          tok(TT.STR, s, l, c); continue;
        }

        // Variable  $name
        if (x === '$') {
          adv(); let n = '';
          while (/\w/.test(ch())) n += adv();
          tok(TT.VAR, n, l, c); continue;
        }

        // Relative time token  +N  or  +N:MM  (looks like VAR or OP but we treat as NUM)
        if (x === '+' && /\d/.test(ch1())) {
          adv(); let n = '';
          while (/[\d.]/.test(ch())) n += adv();
          if (ch() === ':' && /\d/.test(src[i + 1])) { adv(); let s = ''; while (/[\d.]/.test(ch())) s += adv(); tok(TT.NUM, { rel: true, v: +n * 60 + +s }, l, c); }
          else tok(TT.NUM, { rel: true, v: +n }, l, c);
          continue;
        }

        // Numbers  N  or  N:MM  (timestamp)
        if (/\d/.test(x)) {
          let n = ''; while (/[\d.]/.test(ch())) n += adv();
          if (ch() === ':' && /\d/.test(src[i + 1])) { adv(); let s = ''; while (/[\d.]/.test(ch())) s += adv(); tok(TT.NUM, { rel: false, v: +n * 60 + +s }, l, c); }
          else tok(TT.NUM, +n, l, c);
          continue;
        }

        // Multi-char operators
        const op2 = src.slice(i, i + 2);
        if (['==', '!=', '<=', '>=', '&&', '||'].includes(op2)) { i += 2; col += 2; tok(TT.OP, op2, l, c); continue; }

        // Single-char operators
        if ('=<>!+-*/%'.includes(x)) { adv(); tok(TT.OP, x, l, c); continue; }

        // Braces & parens
        if (x === '{') { adv(); tok(TT.LB, '{', l, c); continue; }
        if (x === '}') { adv(); tok(TT.RB, '}', l, c); continue; }
        if (x === '(') { adv(); tok(TT.LP, '(', l, c); continue; }
        if (x === ')') { adv(); tok(TT.RP, ')', l, c); continue; }

        // Words / identifiers / dotted (audio.pause etc.)
        if (/[a-zA-Z_]/.test(x)) {
          let w = ''; while (/[\w.]/.test(ch())) w += adv();
          tok(TT.WORD, w, l, c); continue;
        }

        adv(); // unknown — skip
      }
      tok(TT.EOF, null, ln, col);
      return toks;
    }

    // ══════════════════════════════════════════════════════════════════
    // PARSER — produces AST
    // ══════════════════════════════════════════════════════════════════

    // Keywords that cannot be used as command names or bare values
    const KW = new Set([
      'var', 'set', 'if', 'elif', 'else', 'while', 'repeat', 'break',
      'continue', 'sequence', 'call', 'at', 'together', 'wait', 'end',
      'true', 'false', 'for', 'from', 'to', 'volume', 'vol', 'rate',
      'loop', 'sound', 'not'
    ]);

    const OPT_KEYS = new Set(['for', 'from', 'to', 'volume', 'vol', 'rate', 'loop', 'sound']);

    function parse(src) {
      const probs = [];
      const allVars = {};
      const seqs = {};
      const events = [];
      let toks;

      try { toks = tokenize(src); }
      catch (e) {
        return { events: [], probs: [{ L: 1, c: 0, n: 1, msg: 'Tokenizer error: ' + e.message, level: 'error' }], vars: {}, seqs: {}, end: 2 };
      }

      let pos = 0;
      const p = () => toks[pos] || { t: TT.EOF, v: null, ln: 1, col: 0 };
      const p2 = () => toks[pos + 1] || { t: TT.EOF };
      const adv = () => toks[pos++] || { t: TT.EOF };
      const is = t => p().t === t;
      const isW = w => p().t === TT.WORD && p().v.toLowerCase() === w.toLowerCase();

      const err = (msg, tok, hint = '', level = 'error') => {
        const t = tok || p();
        probs.push({ L: t.ln || 1, c: t.col || 0, n: String(t.v || '').length || 1, msg, hint, level });
      };
      const warn = (msg, tok, hint = '') => err(msg, tok, hint, 'warning');

      // skip whitespace / comments / newlines
      const skip = (...ts) => { while (ts.includes(p().t) || p().t === TT.CMT) adv(); };

      // ── Expression parser (Pratt-style) ──────────────────────────
      const expr = () => exprOr();
      const exprOr = () => { let l = exprAnd(); while (p().t === TT.OP && p().v === '||') { adv(); l = { t: '||', l, r: exprAnd() }; } return l; };
      const exprAnd = () => { let l = exprCmp(); while (p().t === TT.OP && p().v === '&&') { adv(); l = { t: '&&', l, r: exprCmp() }; } return l; };
      const exprCmp = () => {
        let l = exprAdd();
        while (p().t === TT.OP && ['==', '!=', '<', '>', '<=', '>='].includes(p().v)) { const op = adv().v; l = { t: op, l, r: exprAdd() }; }
        return l;
      };
      const exprAdd = () => {
        let l = exprMul();
        while (p().t === TT.OP && ['+', '-'].includes(p().v)) { const op = adv().v; l = { t: op, l, r: exprMul() }; }
        return l;
      };
      const exprMul = () => {
        let l = exprUn();
        while (p().t === TT.OP && ['*', '/', '%'].includes(p().v)) { const op = adv().v; l = { t: op, l, r: exprUn() }; }
        return l;
      };
      const exprUn = () => {
        if (p().t === TT.OP && p().v === '!') { adv(); return { t: '!', o: exprUn() }; }
        if (p().t === TT.WORD && p().v.toLowerCase() === 'not') { adv(); return { t: '!', o: exprUn() }; }
        if (p().t === TT.OP && p().v === '-') { adv(); return { t: 'neg', o: exprUn() }; }
        return exprPrim();
      };
      const exprPrim = () => {
        const t = p();
        if (t.t === TT.NUM && typeof t.v === 'number') { adv(); return { t: 'num', v: t.v }; }
        if (t.t === TT.STR) { adv(); return { t: 'str', v: t.v }; }
        if (t.t === TT.VAR) { adv(); return { t: 'var', v: t.v }; }
        if (t.t === TT.WORD && t.v === 'true') { adv(); return { t: 'bool', v: true }; }
        if (t.t === TT.WORD && t.v === 'false') { adv(); return { t: 'bool', v: false }; }
        if (t.t === TT.WORD && !KW.has(t.v.toLowerCase())) { adv(); return { t: 'str', v: t.v }; }
        if (t.t === TT.LP) { adv(); const e = expr(); if (is(TT.RP)) adv(); else err('Expected ")"', p()); return e; }
        return { t: 'num', v: 0 };
      };

      // ── Block  { stmts… } ────────────────────────────────────────
      function parseBlock() {
        const stmts = [];
        if (!is(TT.LB)) { err('Expected "{"', p(), 'Did you forget to open a block with "{"?'); return stmts; }
        adv(); skip(TT.NL, TT.CMT);
        while (!is(TT.RB) && !is(TT.EOF)) {
          skip(TT.NL, TT.CMT);
          if (is(TT.RB) || is(TT.EOF)) break;
          const s = parseStmt();
          if (s) stmts.push(s);
        }
        if (is(TT.RB)) adv();
        else err('Missing closing "}"', p());
        return stmts;
      }

      // ── Single statement ─────────────────────────────────────────
      function parseStmt() {
        skip(TT.CMT);
        if (is(TT.NL) || is(TT.EOF) || is(TT.RB)) return null;

        const t = p(), w = t.t === TT.WORD ? t.v.toLowerCase() : null;

        // var / set
        if (w === 'var' || w === 'set') {
          adv();
          const nTok = p();
          if (nTok.t !== TT.WORD) { err(`Expected variable name after "${w}"`, nTok, 'Example: var count = 5'); eol(); return null; }
          adv();
          let val = { t: 'num', v: 0 };
          if (p().t === TT.OP && p().v === '=') { adv(); val = expr(); }
          else if (w === 'set') { warn(`"set" without "=" — defaulting to 0`, nTok); }
          eol();
          return { k: w, name: nTok.v, val, ln: t.ln };
        }

        // if
        if (w === 'if') return parseIf();

        // repeat
        if (w === 'repeat') {
          adv();
          const cnt = expr();
          skip(TT.NL);
          const body = parseBlock();
          return { k: 'repeat', cnt, body, ln: t.ln };
        }

        // while
        if (w === 'while') {
          adv();
          const cond = expr();
          skip(TT.NL);
          const body = parseBlock();
          return { k: 'while', cond, body, ln: t.ln };
        }

        // break / continue / end
        if (w === 'break') { adv(); eol(); return { k: 'break', ln: t.ln }; }
        if (w === 'continue') { adv(); eol(); return { k: 'cont', ln: t.ln }; }
        if (w === 'end') { adv(); eol(); return { k: 'end', ln: t.ln }; }

        // call sequenceName
        if (w === 'call') {
          adv();
          if (p().t !== TT.WORD) { err('Expected sequence name after "call"', p()); eol(); return null; }
          const n = adv().v;
          eol();
          return { k: 'call', name: n, ln: t.ln };
        }

        // together { … }
        if (w === 'together') {
          adv(); skip(TT.NL);
          const body = parseBlock();
          return { k: 'together', body, ln: t.ln };
        }

        // wait N
        if (w === 'wait') {
          adv();
          const dur = expr();
          eol();
          return { k: 'wait', dur, ln: t.ln };
        }

        // Command: any other word
        if (t.t === TT.WORD) {
          adv();
          const { args, opts } = cmdArgs();
          eol();
          return { k: 'cmd', cmd: t.v.toLowerCase(), args, opts, ln: t.ln };
        }

        err(`Unexpected token "${p().v || p().t}"`, p(), 'Lines inside a block must be commands (e.g. expression happy) or control statements (if / repeat / wait).');
        eol();
        return null;
      }

      function parseIf() {
        const ifTok = adv(); // consume 'if'
        const cond = expr(); skip(TT.NL);
        const then = parseBlock();
        const elifs = []; let els = null;
        while (true) {
          skip(TT.NL, TT.CMT);
          const pp = p(), ww = pp.t === TT.WORD ? pp.v.toLowerCase() : '';
          if (ww === 'elif') { adv(); const ec = expr(); skip(TT.NL); elifs.push({ cond: ec, body: parseBlock() }); }
          else if (ww === 'else') { adv(); skip(TT.NL); els = parseBlock(); break; }
          else break;
        }
        return { k: 'if', cond, then, elifs, els, ln: ifTok.ln };
      }

      // Collect command arguments and options (for N, vol N, etc.)
      function cmdArgs() {
        const args = [], opts = {};
        while (!is(TT.NL) && !is(TT.EOF) && !is(TT.RB) && !is(TT.CMT)) {
          const t = p(), w = t.t === TT.WORD ? t.v.toLowerCase() : '';
          if (OPT_KEYS.has(w)) {
            const key = adv().v.toLowerCase();
            if (key === 'loop' || key === 'sound') { opts[key] = true; continue; }
            const rv = rawVal();
            opts[key === 'vol' ? 'volume' : key] = rv;
          } else {
            const rv = rawVal();
            if (rv !== null) args.push(rv);
          }
        }
        return { args, opts };
      }

      // Read a single primitive value (literal, string, or $var)
      function rawVal() {
        const t = p();
        if (t.t === TT.STR) { adv(); return t.v; }
        if (t.t === TT.NUM && typeof t.v === 'number') { adv(); return t.v; }
        if (t.t === TT.VAR) { adv(); return { __var: t.v }; }
        if (t.t === TT.WORD && !KW.has(t.v.toLowerCase())) { adv(); return t.v; }
        if (t.t === TT.WORD && (t.v === 'true' || t.v === 'false')) { adv(); return t.v === 'true'; }
        return null;
      }

      // Skip to end of logical line (stops at NL, EOF, CMT, RB)
      function eol() {
        while (!is(TT.NL) && !is(TT.EOF) && !is(TT.RB)) { if (is(TT.CMT)) { adv(); break; } adv(); }
      }

      // ── Top-level parse ──────────────────────────────────────────
      let prevT = 0;

      while (!is(TT.EOF)) {
        skip(TT.NL, TT.CMT);
        if (is(TT.EOF)) break;

        const t = p(), w = t.t === TT.WORD ? t.v.toLowerCase() : '';

        // ── var (top-level; also initialises allVars for linting) ──
        if (w === 'var') {
          adv();
          const nTok = adv();
          if (nTok.t !== TT.WORD) { err('Expected variable name', nTok, 'Example: var speed = 3'); skip(TT.NL); continue; }
          let val = 0;
          if (p().t === TT.OP && p().v === '=') { adv(); val = staticEval(expr()); }
          allVars[nTok.v] = val;
          skip(TT.NL);
          // Also emit as an event at t=0 so runtime knows the initial value
          events.push({ t: 0, body: [{ k: 'var', name: nTok.v, val: { t: 'num', v: val }, ln: nTok.ln }], L: nTok.ln, _init: true });
          continue;
        }

        // ── sequence NAME { … } ──
        if (w === 'sequence') {
          adv();
          if (p().t !== TT.WORD) { err('Expected sequence name', p(), 'Example: sequence myGreet { ... }'); skip(TT.NL); continue; }
          const nTok = adv();
          skip(TT.NL);
          seqs[nTok.v] = parseBlock();
          skip(TT.NL);
          continue;
        }

        // ── at TIME { … } or  at TIME single-stmt ──
        if (w === 'at') {
          adv();
          if (p().t !== TT.NUM) { err('Expected a time after "at"', p(), 'Example: at 3.5 { say "hello" for 2 }'); eol(); skip(TT.NL); continue; }
          const numTok = adv();
          const tm = resolveTime(numTok, prevT);
          prevT = tm;
          skip(TT.NL);
          if (is(TT.LB)) { const body = parseBlock(); events.push({ t: tm, body, L: t.ln }); }
          else { const s = parseStmt(); if (s) events.push({ t: tm, body: [s], L: t.ln }); }
          skip(TT.NL);
          continue;
        }

        // ── TIME command…  or  TIME { … } ── (flat style)
        if (t.t === TT.NUM) {
          const numTok = adv();
          const tm = resolveTime(numTok, prevT);
          prevT = tm;
          skip(TT.CMT);
          if (is(TT.NL) || is(TT.EOF)) { skip(TT.NL); continue; }
          if (is(TT.LB)) { const body = parseBlock(); events.push({ t: tm, body, L: t.ln }); }
          else { const s = parseStmt(); if (s) events.push({ t: tm, body: [s], L: t.ln }); }
          skip(TT.NL);
          continue;
        }

        // ── Unknown top-level token ──
        if (!is(TT.NL) && !is(TT.EOF) && !is(TT.CMT)) {
          err(`Lines must start with a time (e.g. 3.5), "at", "var", or "sequence" — got "${t.v}"`, t,
            'Example: 2 expression happy   or   at 5 { expression excited }');
        }
        eol(); skip(TT.NL);
      }

      // Sort by time, keep init vars first
      events.sort((a, b) => a._init && !b._init ? -1 : !a._init && b._init ? 1 : a.t - b.t);

      const endT = events.filter(e => !e._init).reduce((m, e) => Math.max(m, e.t), 0) + 2;
      return { events, probs, vars: allVars, seqs, end: endT };
    }

    function resolveTime(numTok, prev) {
      const nv = numTok.v;
      if (typeof nv === 'object' && nv.rel) return prev + nv.v;
      if (typeof nv === 'object') return nv.v;
      return nv;
    }

    function staticEval(e) {
      if (!e) return 0;
      switch (e.t) {
        case 'num': return e.v;
        case 'str': return e.v;
        case 'bool': return e.v;
        case '+': { const l = staticEval(e.l), r = staticEval(e.r); return typeof l === 'string' || typeof r === 'string' ? String(l) + String(r) : l + r; }
        case '-': return staticEval(e.l) - staticEval(e.r);
        case '*': return staticEval(e.l) * staticEval(e.r);
        case '/': { const r = staticEval(e.r); return r ? staticEval(e.l) / r : 0; }
        default: return 0;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // RUNTIME — executes AST nodes
    // ══════════════════════════════════════════════════════════════════

    const SIG_BREAK = Symbol('break');
    const SIG_CONT = Symbol('continue');
    const SIG_STOP = Symbol('stop');
    const SIG_END = Symbol('end');

    class Runtime {
      constructor(seqs) {
        this.seqs = seqs || {};
        this.vars = {};
        this.stopped = false;
      }

      stop() { this.stopped = true; }

      // Evaluate an expression node
      eval(e, sc = {}) {
        if (this.stopped) throw SIG_STOP;
        if (!e) return 0;
        switch (e.t) {
          case 'num': return e.v;
          case 'bool': return e.v;
          case 'str': return String(e.v).replace(/\$(\w+)/g, (_, n) => sc[n] ?? this.vars[n] ?? '');
          case 'var': return sc[e.v] ?? this.vars[e.v] ?? 0;
          case '+': { const l = this.eval(e.l, sc), r = this.eval(e.r, sc); return (typeof l === 'string' || typeof r === 'string') ? String(l) + String(r) : l + r; }
          case '-': return this.eval(e.l, sc) - this.eval(e.r, sc);
          case '*': return this.eval(e.l, sc) * this.eval(e.r, sc);
          case '/': { const r = this.eval(e.r, sc); return r ? this.eval(e.l, sc) / r : 0; }
          case '%': return this.eval(e.l, sc) % this.eval(e.r, sc);
          case '==': return this.eval(e.l, sc) == this.eval(e.r, sc);
          case '!=': return this.eval(e.l, sc) != this.eval(e.r, sc);
          case '<': return this.eval(e.l, sc) < this.eval(e.r, sc);
          case '>': return this.eval(e.l, sc) > this.eval(e.r, sc);
          case '<=': return this.eval(e.l, sc) <= this.eval(e.r, sc);
          case '>=': return this.eval(e.l, sc) >= this.eval(e.r, sc);
          case '&&': return this.eval(e.l, sc) && this.eval(e.r, sc);
          case '||': return this.eval(e.l, sc) || this.eval(e.r, sc);
          case '!': return !this.eval(e.o, sc);
          case 'neg': return -this.eval(e.o, sc);
          default: return 0;
        }
      }

      // Resolve a raw value (literal, or __var reference)
      res(v, sc = {}) {
        if (v === null || v === undefined) return v;
        if (typeof v === 'number' || typeof v === 'boolean') return v;
        if (typeof v === 'string') return v.replace(/\$(\w+)/g, (_, n) => sc[n] ?? this.vars[n] ?? '');
        if (v && v.__var) return sc[v.__var] ?? this.vars[v.__var] ?? 0;
        return v;
      }

      async runBlock(stmts, sc = {}) {
        for (const s of stmts) {
          if (this.stopped) throw SIG_STOP;
          const sig = await this.runStmt(s, sc);
          if (sig === SIG_BREAK || sig === SIG_CONT || sig === SIG_END) return sig;
        }
      }

      async runStmt(s, sc = {}) {
        if (!s || this.stopped) { if (this.stopped) throw SIG_STOP; return; }

        switch (s.k) {

          case 'var':
          case 'set': {
            const v = this.eval(s.val, sc);
            sc[s.name] = v; this.vars[s.name] = v;
            break;
          }

          case 'if': {
            if (this.eval(s.cond, sc)) {
              return await this.runBlock(s.then, { ...sc });
            }
            for (const el of s.elifs) {
              if (this.eval(el.cond, sc)) return await this.runBlock(el.body, { ...sc });
            }
            if (s.els) return await this.runBlock(s.els, { ...sc });
            break;
          }

          case 'repeat': {
            const n = Math.max(0, Math.floor(+this.eval(s.cnt, sc)));
            for (let i = 0; i < n; i++) {
              if (this.stopped) throw SIG_STOP;
              const sig = await this.runBlock(s.body, { ...sc, __i: i, __n: n });
              if (sig === SIG_BREAK) break;
              if (sig === SIG_END) return SIG_END;
              // SIG_CONT → just continue loop
            }
            break;
          }

          case 'while': {
            let guard = 0;
            while (!this.stopped && this.eval(s.cond, sc) && guard++ < 10000) {
              const sig = await this.runBlock(s.body, { ...sc });
              if (sig === SIG_BREAK) break;
              if (sig === SIG_END) return SIG_END;
            }
            if (guard >= 10000) console.warn('[MM] while loop exceeded 10 000 iterations — stopped for safety');
            break;
          }

          case 'break': return SIG_BREAK;
          case 'cont': return SIG_CONT;
          case 'end': throw SIG_END;

          case 'call': {
            const body = this.seqs[s.name];
            if (!body) { console.warn('[MM] Unknown sequence:', s.name); break; }
            return await this.runBlock(body, { ...sc });
          }

          case 'together': {
            if (this.stopped) throw SIG_STOP;
            // Run all statements in parallel; stop signals bubble up
            await Promise.all(s.body.map(st =>
              this.runStmt(st, { ...sc }).catch(sig => {
                if (sig === SIG_STOP || sig === SIG_END) throw sig;
              })
            ));
            break;
          }

          case 'wait': {
            const ms = Math.max(0, +this.eval(s.dur, sc)) * 1000;
            await this.zleep(ms);
            break;
          }

          case 'cmd':
            await this.runCmd(s.cmd, s.args, s.opts, sc);
            break;
        }
      }

      // Interruptible sleep — polls the stopped flag every 50ms
      zleep(ms) {
        return new Promise((ok, fail) => {
          if (this.stopped) return fail(SIG_STOP);
          if (ms <= 0) return ok();
          const t = Date.now() + ms;
          const tick = () => {
            if (this.stopped) return fail(SIG_STOP);
            const left = t - Date.now();
            if (left <= 0) return ok();
            setTimeout(tick, Math.min(left, 50));
          };
          setTimeout(tick, 0);
        });
      }

      // ── Execute a command ────────────────────────────────────────
      async runCmd(cmd, rawArgs, rawOpts, sc) {
        if (this.stopped) throw SIG_STOP;

        const a = rawArgs.map(v => this.res(v, sc));
        const o = {};
        for (const [k, v] of Object.entries(rawOpts))
          o[k] = (typeof v === 'boolean') ? v : this.res(v, sc);

        const forMs = o.for !== undefined ? +o.for * 1000 : undefined;
        const fromSec = o.from !== undefined ? +o.from : undefined;
        const toSec = o.to !== undefined ? +o.to : undefined;
        const vol = o.volume !== undefined ? Math.min(1, Math.max(0, +o.volume)) : undefined;
        const rate = o.rate !== undefined ? +o.rate : undefined;
        const loopIt = !!o.loop;
        const withSnd = !!o.sound;

        switch (cmd) {

          // ── Expressions ──────────────────────────────────────────
          case 'expression':
          case 'expr': {
            const name = String(a[0] || 'neutral').toLowerCase();
            try { await M.expression(name); } catch (e) { }
            if (forMs) {
              await this.zleep(forMs);
              try { await M.expression('neutral'); } catch (e) { }
            }
            break;
          }

          // ── Moves ─────────────────────────────────────────────────
          case 'move': {
            const name = String(a[0] || 'bounce');
            try { await M.move(name, forMs ? { duration: forMs } : {}); } catch (e) { }
            break;
          }

          // ── Look direction ────────────────────────────────────────
          case 'look': {
            try { await M.look(String(a[0] || 'center')); } catch (e) { }
            if (forMs) { await this.zleep(forMs); try { await M.look('center'); } catch (e) { } }
            break;
          }

          // ── Say (caption + lip sync) ──────────────────────────────
          case 'say': {
            const text = String(a[0] || '');
            const dur = forMs || Math.max(1400, text.length * 70);
            try { await M.say(text, dur); } catch(e) {}
            break;
          }

          // ── Talk (lip-sync only, no caption) ─────────────────────
          case 'talk': {
            const dur = forMs || 2000;
            if (typeof ENG.sayUntil !== 'undefined') ENG.sayUntil = (ENG.time || 0) + (dur / 1000);
            await this.zleep(dur);
            break;
          }

          // ── Effects ───────────────────────────────────────────────
          case 'fx': {
            try { M.fx(String(a[0] || 'sparkle'), +(a[1] ?? 5)); } catch (e) { }
            break;
          }

          // ── Walking ───────────────────────────────────────────────
          case 'walkto': {
            try { await M.walkTo(+(a[0] || 0), forMs); } catch (e) { }
            break;
          }
          case 'walk': {
            try { await M.walk(+(a[0] || 0), forMs); } catch (e) { }
            break;
          }

          // ── Enter / Exit / Peek ───────────────────────────────────
          case 'enter': {
            try { await M.enter(String(a[0] || 'left')); } catch (e) { }
            break;
          }
          case 'exit': {
            const side = String(a[0] || 'right');
            try { await M.exit(side, forMs); } catch (e) { }
            break;
          }
          case 'peek': {
            try { await M.peek(String(a[0] || 'right'), forMs); } catch (e) { }
            break;
          }

          // ── Blink ─────────────────────────────────────────────────
          case 'blink': {
            try { await M.blink(); } catch (e) { }
            break;
          }

          // ── Lean (tilt body) ──────────────────────────────────────
          case 'lean': {
            try { M.lean(+(a[0] || 0)); } catch (e) { }
            if (forMs) { await this.zleep(forMs); try { M.lean(0); } catch (e) { } }
            break;
          }

          // ── Background ────────────────────────────────────────────
          case 'background': {
            const name = String(a[0] || 'tva').toLowerCase();
            if (name === 'video') {
              try {
                M.background('video', String(a[1] || ''), {
                  from: fromSec, to: toSec, loop: loopIt, rate: rate || 1, sound: withSnd
                });
              } catch (e) { }
            } else {
              try { M.background(name); } catch (e) { }
              if (forMs) { await this.zleep(forMs); try { M.background('tva'); } catch (e) { } }
            }
            break;
          }

          // ── Find (timeline search) ────────────────────────────────
          case 'find': {
            try { await M.find(String(a[0] || ''), forMs); } catch (e) { }
            break;
          }

          // ── Audio commands ────────────────────────────────────────
          case 'audio': {
            const file = String(a[0] || '');
            if (file) AU.load(file);
            if (vol !== undefined) AU.el.volume = vol;
            if (fromSec !== undefined) AU.el.currentTime = fromSec;
            try { await AU.play(); } catch (e) { }
            if (forMs) { await this.zleep(forMs); AU.el.pause(); }
            break;
          }
          case 'audio.pause': { AU.el.pause(); break; }
          case 'audio.resume': { try { await AU.el.play(); } catch (e) { } break; }
          case 'audio.stop': { AU.stop(); break; }
          case 'stopaudio': { AU.stop(); break; }
          case 'audio.volume': {
            const v = +(a[0] ?? 0.8);
            AU.el.volume = Math.min(1, Math.max(0, v));
            break;
          }
          case 'audio.seek': {
            const s = Math.max(0, +(a[0] || 0));
            AU.el.currentTime = s;
            break;
          }
          case 'audio.rate':
          case 'audio.speed': {
            AU.el.playbackRate = Math.max(0.1, Math.min(4, +(a[0] || 1)));
            break;
          }
          case 'audio.loop': {
            AU.el.loop = a[0] === false ? false : true;
            break;
          }
          case 'audio.fade': {
            const target = +(a[0] ?? 0), dur2 = +(a[1] ?? 1) * 1000;
            const start = AU.el.volume, t0 = performance.now();
            const step = () => {
              if (this.stopped) return;
              const p = Math.min(1, (performance.now() - t0) / dur2);
              AU.el.volume = Math.max(0, Math.min(1, start + (target - start) * p));
              if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
            await this.zleep(dur2);
            break;
          }

          default:
            console.warn(`[MM Studio] Unknown command: "${cmd}" — check the GUIDE.html for valid commands`);
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // SYNTAX HIGHLIGHTER
    // ══════════════════════════════════════════════════════════════════

    const HL_KW = new Set(['var', 'set', 'if', 'elif', 'else', 'while', 'repeat', 'break',
      'continue', 'sequence', 'call', 'at', 'together', 'wait', 'end',
      'for', 'from', 'to', 'volume', 'vol', 'rate', 'loop', 'sound',
      'true', 'false', 'not']);
    const HL_CMD = new Set(['expression', 'expr', 'move', 'look', 'say', 'talk', 'fx', 'walkto',
      'walk', 'enter', 'exit', 'peek', 'blink', 'lean', 'find', 'background',
      'audio', 'stopaudio', 'audio.pause', 'audio.resume', 'audio.stop',
      'audio.volume', 'audio.seek', 'audio.rate', 'audio.speed',
      'audio.loop', 'audio.fade']);
    const HL_EXPR = new Set(Object.keys(EXPRESSIONS));
    const HL_MOVE = new Set(Object.keys(MOVES).filter(k => !k.includes('~')));
    const HL_FX = new Set(Object.keys(FXG));
    const HL_BG = new Set(Object.keys(BG));
    const HL_LOOK = new Set(['left', 'right', 'up', 'down', 'center', 'upleft', 'upright', 'downleft',
      'downright', 'farleft', 'farright', 'offleft', 'offright']);

    function hlLine(line) {
      let out = '', i = 0;
      const eat = rx => { const m = line.slice(i).match(new RegExp('^(?:' + rx + ')')); if (m) { i += m[0].length; return m[0]; } return null; };
      let m;
      while (i < line.length) {
        if ((m = eat('\\s+'))) { out += m; continue; }
        if (line[i] === '#' || (line[i] === '/' && line[i + 1] === '/')) { out += `<span class="hl-comment">${esc(line.slice(i))}</span>`; break; }
        if ((m = eat('"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\''))) { out += `<span class="hl-str">${esc(m)}</span>`; continue; }
        if ((m = eat('\\$\\w+'))) { out += `<span class="hl-var">${esc(m)}</span>`; continue; }
        if ((m = eat('\\+\\d+(?:\\.\\d+)?(?::\\d+(?:\\.\\d+)?)?'))) { out += `<span class="hl-time">${esc(m)}</span>`; continue; }
        if ((m = eat('\\d+(?::\\d+)?(?:\\.\\d+)?'))) { out += `<span class="hl-time">${esc(m)}</span>`; continue; }
        if ((m = eat('==|!=|<=|>=|&&|\\|\\|'))) { out += `<span class="hl-op">${esc(m)}</span>`; continue; }
        if (line[i] === '{') { out += `<span class="hl-brace">${line[i++]}</span>`; continue; }
        if (line[i] === '}') { out += `<span class="hl-brace">${line[i++]}</span>`; continue; }
        if ((m = eat('[a-zA-Z_][\\w.]*'))) {
          const lo = m.toLowerCase();
          if (HL_KW.has(lo)) out += `<span class="hl-kw">${esc(m)}</span>`;
          else if (HL_CMD.has(lo)) out += `<span class="hl-cmd">${esc(m)}</span>`;
          else if (HL_EXPR.has(lo) || HL_MOVE.has(lo) || HL_FX.has(lo) || HL_BG.has(lo) || HL_LOOK.has(lo))
            out += `<span class="hl-val">${esc(m)}</span>`;
          else out += `<span class="hl-ident">${esc(m)}</span>`;
          continue;
        }
        out += esc(line[i++]);
      }
      return out || '\u200B';
    }

    function highlightCode(code) {
      return code.split('\n').map(hlLine).join('\n');
    }

    // ══════════════════════════════════════════════════════════════════
    // EDITOR WIRING
    // ══════════════════════════════════════════════════════════════════

    const edEl = $('ed');
    const gutEl = $('gut');
    const hlEl = $('ed-highlights');
    const probEl = $('probs');
    const statEl = $('status');
    const cpEl = $('cursor-pos');

    let lintResult = null, lintTimer, curLn = 1;

    function syncHL() {
      if (!hlEl || !edEl) return;
      const v = edEl.value;
      hlEl.innerHTML = highlightCode(v) + '\n\u200B';
      hlEl.scrollTop = edEl.scrollTop;
      hlEl.scrollLeft = edEl.scrollLeft;
    }

    function syncGut() {
      if (!gutEl || !edEl) return;
      const lines = edEl.value.split('\n').length;
      const byL = {};
      if (lintResult) lintResult.probs.forEach(p => (byL[p.L] = byL[p.L] || []).push(p));
      let html = '';
      for (let i = 1; i <= lines; i++) {
        const ps = byL[i];
        const cls = ps ? (ps.some(p => p.level === 'error') ? 'err' : 'warn') : '';
        const isCur = i === curLn ? ' cur' : '';
        const title = ps ? ` title="${esc(ps.map(p => p.msg).join(' | '))}"` : '';
        html += `<div class="${cls}${isCur}"${title}>${i}</div>`;
      }
      gutEl.innerHTML = html;
      gutEl.scrollTop = edEl.scrollTop;
    }

    function updateCursor() {
      const val = edEl.value.substring(0, edEl.selectionStart);
      const lns = val.split('\n');
      curLn = lns.length;
      const col = lns[curLn - 1].length + 1;
      if (cpEl) cpEl.textContent = `Ln ${curLn}, Col ${col}`;
      syncGut();
    }

    function doLint() {
      lintResult = parse(edEl.value);
      renderProbs(lintResult.probs);
      renderStatus(lintResult);
      syncHL();
      syncGut();
      try { localStorage.setItem('mm.script', edEl.value); } catch { }
      return lintResult;
    }

    function renderProbs(probs) {
      if (!probEl) return;
      probEl.innerHTML = probs.length
        ? probs.map(p => `<li class="${p.level}" data-l="${p.L}" data-c="${p.c || 0}" data-n="${p.n || 1}"><b>Line ${p.L}:</b> ${esc(p.msg)}${p.hint ? `<br><small>${esc(p.hint)}</small>` : ''}</li>`).join('')
        : '<li class="ok">✓ No problems — script is ready to play</li>';
    }

    function renderStatus(res) {
      if (!statEl) return;
      const er = (res.probs || []).filter(p => p.level === 'error').length;
      const wn = (res.probs || []).length - er;
      statEl.innerHTML = `${(res.events || []).filter(e => !e._init).length} event${(res.events || []).length !== 1 ? 's' : ''} · length <b>${fmtT(res.end || 0)}</b> · <span class="${er ? 'bad' : 'good'}">${er} error${er === 1 ? '' : 's'}</span> · ${wn} warning${wn === 1 ? '' : 's'}`;
    }

    function markLine(L) {
      curLn = L || 1;
      syncGut();
    }

    // ── Editor events ───────────────────────────────────────────────
    edEl.addEventListener('input', () => {
      syncHL();
      clearTimeout(lintTimer);
      lintTimer = setTimeout(doLint, 180);
    });

    edEl.addEventListener('scroll', () => {
      gutEl.scrollTop = edEl.scrollTop;
      hlEl.scrollTop = edEl.scrollTop;
      hlEl.scrollLeft = edEl.scrollLeft;
    });

    edEl.addEventListener('keyup', updateCursor);
    edEl.addEventListener('click', updateCursor);
    edEl.addEventListener('focus', updateCursor);

    edEl.addEventListener('keydown', ev => {
      // Ctrl/Cmd+Enter → Play
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); startPlay(true); return; }

      // Tab → indent (2 spaces)
      if (ev.key === 'Tab' && !ev.shiftKey) {
        ev.preventDefault();
        const s = edEl.selectionStart, e2 = edEl.selectionEnd;
        if (s === e2) {
          edEl.setRangeText('  ', s, e2, 'end');
        } else {
          const val = edEl.value;
          const ls = val.lastIndexOf('\n', s - 1) + 1;
          const le = val.indexOf('\n', e2 - 1); const end = le < 0 ? val.length : le;
          const sel = val.slice(ls, end);
          edEl.setRangeText(sel.replace(/^/gm, '  '), ls, end, 'start');
        }
        doLint(); return;
      }

      // Shift+Tab → un-indent
      if (ev.key === 'Tab' && ev.shiftKey) {
        ev.preventDefault();
        const s = edEl.selectionStart, val = edEl.value;
        const ls = val.lastIndexOf('\n', s - 1) + 1;
        if (val.slice(ls, ls + 2) === '  ') edEl.setRangeText('', ls, ls + 2, 'end');
        else if (val[ls] === ' ') edEl.setRangeText('', ls, ls + 1, 'end');
        doLint(); return;
      }

      // Enter → auto-indent + auto-close {
      if (ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey) {
        const pos = edEl.selectionStart, val = edEl.value;
        const ls = val.lastIndexOf('\n', pos - 1) + 1;
        const indent = val.slice(ls, pos).match(/^\s*/)[0];
        if (val[pos - 1] === '{') {
          ev.preventDefault();
          edEl.setRangeText('\n' + indent + '  \n' + indent + '}', pos, pos, 'start');
          edEl.selectionStart = edEl.selectionEnd = pos + indent.length + 3;
          doLint();
        } else if (indent) {
          setTimeout(() => {
            const np = edEl.selectionStart;
            edEl.setRangeText(indent, np, np, 'end');
            doLint();
          }, 0);
        } else {
          setTimeout(doLint, 0);
        }
      }
    });

    // Click on problem → jump to line
    probEl.addEventListener('click', ev => {
      const li = ev.target.closest('li[data-l]');
      if (!li) return;
      const L = +li.dataset.l;
      const lines = edEl.value.split('\n');
      const off = lines.slice(0, L - 1).join('\n').length + (L > 1 ? 1 : 0);
      edEl.focus();
      edEl.setSelectionRange(off, off + lines[L - 1]?.length || 0);
      edEl.scrollTop = Math.max(0, (L - 4) * 22);
      updateCursor();
    });

    // ── Tabs ─────────────────────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const pane = $('tab-' + btn.dataset.tab);
        if (pane) pane.classList.add('active');
      });
    });

    // ══════════════════════════════════════════════════════════════════
    // INSERT PALETTE
    // ══════════════════════════════════════════════════════════════════

    const LOOK_LIST = ['left', 'right', 'up', 'down', 'center', 'upleft', 'upright', 'downleft', 'downright'];

    function buildPalette() {
      const GROUPS = [
        ['Expressions', 'expression', Object.keys(EXPRESSIONS)],
        ['Moves', 'move', Object.keys(MOVES).filter(k => !k.includes('~')).slice(0, 20)],
        ['Look', 'look', LOOK_LIST],
        ['Effects', 'fx', Object.keys(FXG)],
        ['Backgrounds', 'background', Object.keys(BG)],
        ['Stage', '', ['enter left', 'enter right', 'exit left', 'exit right', 'peek left', 'peek right', 'walk 0.3', 'walkTo 0', 'blink', 'talk for 3']],
        ['Control', '', ['repeat 3 {', 'while $i < 5 {', 'if $x > 0 {', 'elif $x == 0 {', 'together {', 'call mySeq', 'wait 1', 'break', 'continue', 'end']],
        ['Audio', '', ['audio "file.mp3" vol 0.8', 'audio.pause', 'audio.resume', 'audio.stop', 'audio.volume 0.5', 'audio.seek 30', 'audio.fade 0 2', 'audio.loop']],
      ];
      const pal = $('palette');
      if (!pal) return;
      pal.innerHTML = GROUPS.map(([title, cmd, items], gi) =>
        `<details${gi === 0 ? ' open' : ''}><summary>${title}</summary><div class="chips">
    ${items.map(n => `<button data-ins="${esc(cmd ? cmd + ' ' + n : n)}">${esc(cmd ? n : n.split(' ')[0])}</button>`).join('')}
    </div></details>`).join('');

      pal.addEventListener('click', ev => {
        const b = ev.target.closest('[data-ins]');
        if (!b) return;
        insertAtCursor('+1 ' + b.dataset.ins);
      });
    }

    function insertAtCursor(text) {
      const pos = edEl.selectionStart, val = edEl.value;
      const nl = val.indexOf('\n', pos), at = nl < 0 ? val.length : nl;
      edEl.setRangeText('\n' + text, at, at, 'end');
      edEl.focus(); doLint();
    }

    // ══════════════════════════════════════════════════════════════════
    // MEDIA LIBRARY
    // ══════════════════════════════════════════════════════════════════

    const mediaMap = new Map();

    function addMedia(file) {
      const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : null;
      if (!kind) { toast(`"${file.name}" — not audio or video`); return; }
      const old = mediaMap.get(file.name);
      if (old) URL.revokeObjectURL(old.url);
      const url = URL.createObjectURL(file);
      const item = { name: file.name, kind, url, dur: NaN, bad: false };
      mediaMap.set(file.name, item);

      // Register with engine
      if (kind === 'audio') AU.files?.set(file.name, url);
      else (ENG.vids || new Map()).set(file.name, url);

      // Probe duration
      const el = document.createElement(kind);
      el.preload = 'metadata'; el.src = url;
      el.onloadedmetadata = () => { item.dur = el.duration; drawMedia(); el.src = ''; };
      el.onerror = () => { item.bad = true; drawMedia(); };
      drawMedia();
    }

    function drawMedia() {
      const el = $('media'); if (!el) return;
      const all = [...mediaMap.values()];
      el.innerHTML = all.length
        ? all.map(m => `<li class="${m.bad ? 'bad' : ''}">
        <span class="ic">${m.kind === 'audio' ? '♪' : '▶'}</span>
        <span class="nm" title="${esc(m.name)}">${esc(m.name)}</span>
        <span class="du">${m.bad ? 'err' : fmtT(m.dur)}</span>
        <button data-use="${esc(m.name)}" title="Insert into script">＋</button>
        <button data-del="${esc(m.name)}" title="Remove">✕</button>
      </li>`).join('')
        : '<li class="empty">No media yet — upload or drag &amp; drop</li>';
    }

    $('media').addEventListener('click', ev => {
      const b = ev.target.closest('button[data-use],button[data-del]');
      if (!b) return;
      if (b.dataset.del) {
        const m = mediaMap.get(b.dataset.del);
        if (m) { URL.revokeObjectURL(m.url); mediaMap.delete(m.name); drawMedia(); }
      } else {
        const m = mediaMap.get(b.dataset.use);
        if (m) insertAtCursor(m.kind === 'audio' ? `+0 audio "${m.name}" vol 0.8` : `+0 background video "${m.name}" loop`);
      }
    });

    $('up').addEventListener('change', ev => { [...ev.target.files].forEach(addMedia); ev.target.value = ''; });

    const dropEl = $('drop');
    ['dragenter', 'dragover'].forEach(n => dropEl.addEventListener(n, e => { e.preventDefault(); dropEl.classList.add('hot'); }));
    ['dragleave', 'drop'].forEach(n => dropEl.addEventListener(n, e => { e.preventDefault(); dropEl.classList.remove('hot'); }));
    dropEl.addEventListener('drop', e => { [...e.dataTransfer.files].forEach(addMedia); });

    // ══════════════════════════════════════════════════════════════════
    // TOOLBAR BUTTONS
    // ══════════════════════════════════════════════════════════════════

    $('btn-undo')?.addEventListener('click', () => { document.execCommand('undo'); doLint(); });
    $('btn-redo')?.addEventListener('click', () => { document.execCommand('redo'); doLint(); });

    $('btn-clear')?.addEventListener('click', () => {
      if (confirm('Clear the entire script? This cannot be undone.')) { edEl.value = ''; doLint(); }
    });

    $('btn-clear-log')?.addEventListener('click', () => { $('log').innerHTML = ''; });

    $('btn-format')?.addEventListener('click', () => {
      edEl.value = edEl.value
        .split('\n').map(l => l.trimEnd()).join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd() + '\n';
      doLint(); toast('Script formatted ✓');
    });

    // ══════════════════════════════════════════════════════════════════
    // RATIO SELECTOR
    // ══════════════════════════════════════════════════════════════════

    function setRatio(r) {
      document.documentElement.style.setProperty('--ar', r === '9:16' ? 9 / 16 : 16 / 9);
      document.querySelectorAll('[data-ratio]').forEach(b => b.classList.toggle('on', b.dataset.ratio === r));
      try { localStorage.setItem('mm.ratio', r); } catch { }
    }
    document.querySelectorAll('[data-ratio]').forEach(b => b.onclick = () => setRatio(b.dataset.ratio));

    // ══════════════════════════════════════════════════════════════════
    // TOAST
    // ══════════════════════════════════════════════════════════════════

    let toastTimer;
    function toast(msg) {
      const t = $('toast');
      t.textContent = msg; t.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
    }

    // ══════════════════════════════════════════════════════════════════
    // PLAYBACK ENGINE
    // ══════════════════════════════════════════════════════════════════

    let runtime = null, runCtx = null;

    async function startPlay(live) {
      if (runCtx) { toast('Already playing — press Stop first'); return; }

      const res = doLint();
      const errs = (res.probs || []).filter(p => p.level === 'error');
      if (errs.length) {
        const pr = $('problems');
        pr.classList.remove('shake'); void pr.offsetWidth; pr.classList.add('shake');
        toast(`Fix ${errs.length} error${errs.length > 1 ? 's' : ''} before playing ↑`);
        return;
      }

      const r = runCtx = { stop: false, live };
      document.body.classList.add('running');
      document.body.classList.toggle('live', live);

      // Reset character + engine
      try { M.reset(); } catch { }
      try { M.background('tva'); } catch { }

      // Resume AudioContext
      try { if (AU.ctx && AU.ctx.state === 'suspended') await AU.ctx.resume(); } catch { }

      // Fullscreen + countdown
      if (live) {
        try { await document.documentElement.requestFullscreen?.(); } catch { }
        await countdown(r);
      }

      if (!r.stop) {
        runtime = new Runtime(res.seqs);
        runtime.vars = { ...(res.vars || {}) };

        const events = [...(res.events || [])].sort((a, b) => a.t - b.t);
        const end = res.end || 30;
        const t0 = performance.now();
        const pending = [];

        await new Promise(done => {
          const id = setInterval(() => {
            if (r.stop) { clearInterval(id); done(); return; }
            const now = (performance.now() - t0) / 1000;

            // Fire due events
            while (events.length && events[0].t <= now) {
              const ev = events.shift();
              if (!ev._init) markLine(ev.L || 1);
              const p = runtime.runBlock(ev.body, { ...runtime.vars })
                .catch(sig => {
                  if (sig === SIG_END) { r.stop = true; }
                  else if (sig !== SIG_STOP) console.warn('[MM Studio] Block signal:', sig);
                });
              pending.push(p);
            }

            // Update progress bar
            const pct = Math.min(100, now / end * 100);
            $('fill').style.width = pct + '%';
            $('clock').textContent = fmtT(now) + ' / ' + fmtT(end);

            if (r.stop || now >= end) { clearInterval(id); done(); }
          }, 16);
        });

        if (runtime) runtime.stop();
        await Promise.allSettled(pending);
      }

      finish();
    }

    function finish() {
      if (runtime) { runtime.stop(); runtime = null; }
      try { AU.el.pause(); } catch { }
      try { M.reset(); } catch { }
      try { M.background('tva'); } catch { }
      $('fill').style.width = '0';
      $('clock').textContent = '0:00.00';
      document.body.classList.remove('live', 'running');
      $('cd').textContent = '';
      runCtx = null;
      markLine(0);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { });
    }

    function stopAll() {
      if (runtime) runtime.stop();
      if (runCtx) runCtx.stop = true;
    }

    async function countdown(r) {
      const cd = $('cd');
      for (let n = 5; n > 0 && !r.stop; n--) {
        cd.textContent = n;
        cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
        // Wait 1 second in 100ms chunks so we can break early
        for (let w = 0; w < 10 && !r.stop; w++) await sleep(100);
      }
      cd.textContent = ''; cd.classList.remove('pop');
    }

    // ── Playback buttons ─────────────────────────────────────────────
    $('play').onclick = () => startPlay(true);
    $('preview').onclick = () => startPlay(false);
    $('stop').onclick = stopAll;

    addEventListener('keydown', e => { if (e.key === 'Escape') stopAll(); });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && runCtx?.live) stopAll(); });

    // ══════════════════════════════════════════════════════════════════
    // DEFAULT SCRIPT
    // ══════════════════════════════════════════════════════════════════

    const DEFAULT = `# ╔══════════════════════════════════════════════════════╗
# ║   MISS MINUTES  —  Animation Studio v2              ║
# ║   Modern scripting: variables, loops, if/else, seqs ║
# ╚══════════════════════════════════════════════════════╝

# ── Variables ──────────────────────────────────────────
var greeting = "Hi! I'm Miss Minutes!"
var bounces  = 3
var mood     = "happy"

# ── Reusable sequence ──────────────────────────────────
sequence bigEntrance {
  expression excited
  move bounce
  say $greeting for 3
  fx sparkle 6
}

# ════ TIMELINE ══════════════════════════════════════════

0      background timeline
0.5    enter left

# call the sequence at 2s
at 2 { call bigEntrance }

# conditional at 6s
at 6 {
  if $bounces > 2 {
    expression mischievous
    say "Let\\'s loop!" for 2
  } else {
    expression happy
    say "Ready!" for 2
  }
}

# loop with counter at 9s
at 9 {
  var i = 0
  while $i < $bounces {
    fx heart 3
    set i = $i + 1
    wait 0.55
  }
  move spin
}

# parallel actions at 14s
at 14 {
  together {
    move dance
    say "Watch this!" for 3
  }
}

# audio + volume fade at 18s
# at 18 {
#   audio "yourfile.mp3" vol 0.8
#   wait 4
#   audio.fade 0 2
# }

# exit + peek at 23s
+9    exit right
+1.5  peek left for 2
+3    expression happy
+1    say "Till next time!" for 3`;

    // ── Boot ─────────────────────────────────────────────────────────
    let saved = null, sr = null;
    try { saved = localStorage.getItem('mm.script'); sr = localStorage.getItem('mm.ratio'); } catch { }
    edEl.value = saved || DEFAULT;
    setRatio(sr || '16:9');
    drawMedia();
    buildPalette();
    doLint();
    updateCursor();
    syncHL();

    // ── Override console to log to engine panel ───────────────────────
    const logEl = $('log');
    if (logEl) {
      const _warn = console.warn.bind(console);
      console.warn = (...args) => {
        _warn(...args);
        const d = document.createElement('div');
        d.className = 'err'; d.textContent = args.join(' ');
        logEl.appendChild(d);
        while (logEl.childNodes.length > 80) logEl.firstChild.remove();
        logEl.scrollTop = logEl.scrollHeight;
      };
    }

  } // end main()
})();
