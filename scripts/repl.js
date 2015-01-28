(function(to5, $, _, ace, window) {

  /*
   * Utils for working with the browser's URI (e.g. the query params)
   */
  function UriUtils () {}

  UriUtils.encode = function (value) {
    return window.encodeURIComponent(value);
  };

  UriUtils.decode = function (value) {
    return window.decodeURIComponent('' + value);
  };

  UriUtils.parseQuery = function () {
    var query = window.location.hash.replace(/^\#\?/, '');

    if (!query) {
      return null;
    }

    return query.split('&').map(function(param) {
      var splitPoint = param.indexOf('=');

      return {
        key : param.substring(0, splitPoint),
        value : param.substring(splitPoint + 1)
      };
    }).reduce(function(params, param){
      if (param.key && param.value) {
        params[param.key] = UriUtils.decode(param.value);
      }
      return params;
    }, {});
  };

  UriUtils.updateQuery = function (object) {
    var query = Object.keys(object).map(function(key){
      return key + '=' + UriUtils.encode(object[key]);
    }).join('&');

    window.location.hash = '?' + query;
  };

  /*
   * Long term storage for persistence of state/etc
   */
  function StorageService () {
    this.store = window.localStorage;
  }

  StorageService.prototype.get = function (key) {
    try {
      return JSON.parse(this.store.getItem(key));
    } catch(e) {}
  };

  StorageService.prototype.set = function (key, value) {
    try {
      this.store.setItem(key, JSON.stringify(value));
    } catch(e) {}
  };

  /*
   * Decorating the ACE editor
   */
  function Editor(selector) {
    this.$el = $(selector);
    this.editor = ace.edit(this.$el[0]);
    this.session = this.editor.getSession();
    this.document = this.session.getDocument();

    this.editor.setTheme('ace/theme/tomorrow');
    this.editor.setShowPrintMargin(false);
    this.$el.css({
      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
      lineHeight: 'inherit'
    });

    this.session.setMode('ace/mode/javascript');
    this.session.setUseSoftTabs(true);
    this.session.setTabSize(2);
    this.session.setUseWorker(false);

    this.editor.setOption('scrollPastEnd', 0.33);
  }

  /*
   * Options exposed for the REPL that will influence 6to5's transpiling
   */
  function $checkbox($element){
    return {
      get: function () {
        return $element.is(":checked");
      } ,
      set: function (value) {
        var setting = value !== 'false' && value !== false;
        $element.prop('checked', setting);
      },
      enumerable: true,
      configurable: false
    };
  }

  /*
   * 6to5 options for transpilation as used by the REPL
   */
  function Options () {
    var $experimental = $('#option-experimental');
    var $playground = $('#option-playground');
    var $evaluate = $('#option-evaluate');
    var $loose = $('#option-loose-mode');

    var options = {};
    Object.defineProperties(options, {
      'experimental': $checkbox($experimental),
      'playground': $checkbox($playground),
      'evaluate': $checkbox($evaluate),
      'loose': $checkbox($loose)
    });

    // Merge in defaults
    var defaults = {
      experimental : true,
      playground : true,
      loose : false,
      evaluate : true
    };

    _.assign(options, defaults);

    return options;
  }

  /*
   * 6to5 Web REPL
   */
  function REPL () {
    this.storage = new StorageService();
    var state = this.storage.get('replState') || {};
    _.assign(state, UriUtils.parseQuery());

    this.options = _.assign(new Options(), state);

    this.input = new Editor('.to5-repl-input .ace_editor').editor;
    this.input.setValue(UriUtils.decode(state.code || ''));

    this.output = new Editor('.to5-repl-output .ace_editor').editor;
    this.output.setReadOnly(true);
    this.output.setHighlightActiveLine(false);
    this.output.setHighlightGutterLine(false);

    this.$errorReporter = $('.to5-repl-errors');
    this.$consoleReporter = $('.to5-repl-console');
    this.$toolBar = $('.to5-repl-toolbar');
  }

  REPL.prototype.clearOutput = function () {
    this.$errorReporter.text('');
    this.$consoleReporter.text('');
  };

  REPL.prototype.setOutput = function (output) {
    this.output.setValue(output, -1);
  };

  REPL.prototype.printError = function (message) {
    this.$errorReporter.text(message);
  };

  REPL.prototype.getSource = function () {
    return this.input.getValue();
  };

  REPL.prototype.compile = function () {

    var transformed;
    var code = this.getSource();
    this.clearOutput();

    try {
      transformed = to5.transform(code, {
        experimental: this.options.experimental,
        playground: this.options.playground,
        loose: this.options.loose && "all",
        filename: 'repl'
      });
    } catch (err) {
      this.printError(err.message);
      throw err;
    }

    this.setOutput(transformed.code);

    if (this.options.evaluate) {
      this.evaluate(transformed.code);
    }
  };

  REPL.prototype.evaluate = function(code) {
    var capturingConsole = Object.create(console);
    var $consoleReporter = this.$consoleReporter;
    var buffer = [];
    var error;
    var done = false;

    function flush() {
      $consoleReporter.text(buffer.join('\n'));
    }

    function write(data) {
      buffer.push(data);
      if (done) flush();
    }

    capturingConsole.log = function() {
      if (this !== capturingConsole) { return; }

      var args = Array.prototype.slice.call(arguments);
      Function.prototype.apply.call(console.log, console, args);

      var logs = args.reduce(function (logs, log) {
        if (typeof item === 'string') {
          logs.push(log);
        } else if (log instanceof Function) {
          logs.push(log.toString());
        } else {
          logs.push(JSON.stringify(log));
        }
        return logs;
      }, []);

      write(logs.join(' '));
    };

    try {
      new Function('console', code)(capturingConsole);
    } catch (err) {
      error = err;
      buffer.push(err.message);
    }

    done = true;
    flush();

    if (error) throw error;
  };

  REPL.prototype.persistState = function (state) {
    UriUtils.updateQuery(state);
    this.storage.set('replState', state);
  };

  /*
   * Initialize the REPL
   */
  var repl = new REPL();

  function onSourceChange () {
    var error;
    try {
      repl.compile();
    } catch(err) {
      error = err;
    }
    var code = repl.getSource();
    var state = _.assign(repl.options, {
      code: code
    });
    repl.persistState(state);
    if (error) throw error;
  }

  repl.input.on('change', _.debounce(onSourceChange, 500));
  repl.$toolBar.on('change', onSourceChange);

  repl.compile();


}(to5, $, _, ace, window));
