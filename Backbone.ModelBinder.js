/**
 * @module Backbone.ModelBinder
 * @version 2.0.0
 * @license MIT
 * @author Jeron Diovis
 * Repo: {@link https://github.com/jeron-diovis/Backbone.ModelBinder}
 * Based on Bart Wood's origin module {@link https://github.com/theironcook/Backbone.ModelBinder}
 */
(function (factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define(['underscore', 'jquery', 'backbone'], factory);
	} else {
		// Browser globals
		Backbone.ModelBinder = factory(_, $, Backbone);
	}
}(function (_, $, Backbone) {

	if (!Backbone) {
		throw 'Please include Backbone.js before Backbone.ModelBinder.js';
	}

	var CONST = {
		ModelToView: 'ModelToView',
		ViewToModel: 'ViewToModel'
	};

	var defaultOptions = {
		defaults: {
			boundAttr: 'name',
			filters: {} // { toView: function(value, modelAttrName, model, boundEls), toModel: function(..same arguments...) }
			// elAttr:  string
		},
		elAttr: undefined,
		modelSetOptions: {},
		initialCopyDirection: CONST.ModelToView,
		changeTriggers: {
			'': 'change',
			'[contenteditable]': 'blur'
		},
		skipDefaultTriggers: false,
		useDefaults: false,
		forceGet: false
	};

	var defaultBinders = {
		'html': function($el, value) {
			$el.html(value);
		},

		'text': function($el, value) {
			$el.text(value);
		},

		'disabled': function($el, value) {
			$el.prop('disabled', value);
		},

		'hidden': function($el, value) {
			$el[value ? 'hide' : 'show']();
		},

		'class': function($el, value, prevValue) {
			if (prevValue) {
				$el.removeClass(prevValue);
			}
			if (value) {
				$el.addClass(value);
			}
		},

		'value': function($el, value) {
			if ($el.attr('type')) {
				switch ($el.attr('type')) {
					case 'radio':
						$el.prop('checked', $el.val() === value);
						break;
					case 'checkbox':
						$el.prop('checked', !!value);
						break;
					case 'file':
						break;
					default:
						$el.val(value);
				}
			} else {
				value = value || (value === 0 ? '0' : '');
				if ($el.is('input') || $el.is('select') || $el.is('textarea')) {
					$el.val(value);
				} else {
					$el.text(value);
				}
			}
		}
	};

	// simple inverted binders for convenience
	_.extend(defaultBinders, _.chain({
			'enabled': 'disabled',
			'displayed': 'hidden'
		})
		.map(function(origin, inverted) {
			return [ inverted, function($el, value) {
				value = !value;
				return this[origin].apply(this, arguments);
			} ];
		})
		.object().value()
	);

	// Filters to be applied to either model->view or view->model passed values:

	var filters = {};

	// Internal utility methods:

	var utils = {
		ensureArray: function(value) {
			return _.isArray(value) ? value : [value];
		},

		resultMap: function(value, mapValue) {
			return _.isArray(value) ? _.map(value, function() { return mapValue; }) : mapValue;
		},

		arrayToArgs: function(func) {
			return function(argsArray) {
				return func.apply(this, argsArray);
			};
		},

		updateValues: function(obj, mutator, updateExisting) {
			if (!updateExisting) {
				return _.object(_.keys(obj), _.map(obj, mutator));
			} else {
				_.each(obj, function(value, key, obj) {
					obj[key] = mutator(value, key);
				});
				return obj;
			}
		},

		stream: function(keys, objects, handler, context) {
			keys    = utils.ensureArray(keys);
			objects = utils.ensureArray(objects);
			return _.map(keys, function(key) {
				return handler.apply(
					context || this,
					_.map(objects, function(object) { return object[key]; })
				);
			});
		},

		groupByObj: function(obj, func, convertMap) {
			var newObj = {};
			convertMap || (convertMap = {});
			for (var key in obj) {
				var groupKey = func(obj[key], key, obj);
				var groupObj = newObj[groupKey] || {};
				var converters = convertMap[groupKey] || {};
				groupObj[(converters['key'] || _.identity)(key)] = (converters['value'] || _.identity)(obj[key]);
				newObj[groupKey] = groupObj;

			}
			return newObj;
		},

		partialRight: function(func) {
			var slice = Array.prototype.slice;
			var boundArgs = slice.call(arguments, 1);
			return function() {
				func.apply(this, slice.call(arguments).concat(boundArgs));
			};
		}
	};

	// The Binder:

	var ModelBinder = function () {
		_.bindAll.apply(_, [this].concat(_.functions(this)));

		this._bindings = {};
		this._options = $.extend(true, {}, defaultOptions); // deep clone
		this.binders = _.clone(defaultBinders);
		this.filters = _.clone(filters);

		if (arguments.length > 0) {
			this.bind.apply(this, arguments);
		}
	};

	// Current version of the library.
	ModelBinder.VERSION = '2.0.0';
	ModelBinder.Constants = CONST;

	// class level options, will be added to each binder instance
	ModelBinder.options = {};

	// Static setter for class level options
	ModelBinder.setOptions = function (options, merge) {
		if (merge) {
			$.extend(true, ModelBinder.options, options);
		} else {
			ModelBinder.options = options;
		}
	};

	_.extend(ModelBinder.prototype, {

		test: function(keys) {
			var modelBinder = this,
				binders = modelBinder.binders,
				customBindersNames = _.keys(binders),
				model  = modelBinder._model;

			_.chain(modelBinder._getBindingsForAttributes.apply(modelBinder, keys)).zip(
					modelBinder._options.forceGet ? _.map(keys, model.get, model) : model.pick(keys),
					_.pick(model.previousAttributes(), keys)
				)
				.map(function(bindings) {
					return _.map(bindings, function(binding) {
						var values = Array.prototype.slice.call(arguments, 1);
						return [
							binding.boundEls, // TODO: filter out 'isSetting' elements here
							utils.updateValues(binding.elAttr, function(filter, attribute) {
								var converter = _.partial(modelBinder._getConvertedValue, CONST.ModelToView, binding, attribute);
								return _.has(binders, attribute) ? _.map(values, converter) : converter(values[0]);
							})
						];
					});
				})
				.flatten(true)
				.each(utils.arrayToArgs(function($el, valuesConfig) {
					var customAttrs = valuesConfig,
						directAttrs = _.difference(_.keys(valuesConfig), customBindersNames),
						cssPrefix = 'css:',
						isCssAttr = function(str) { return str.slice(0, cssPrefix.length) === cssPrefix; };

					if (directAttrs.length > 0) {
						customAttrs = _.omit(valuesConfig, directAttrs);
						directAttrs = _.pick(valuesConfig, directAttrs);

						_.map(
							utils.groupByObj(directAttrs,
								function(name) { return isCssAttr(name) ? 'css' : 'attr'; },
								{
									'css': { key: utils.partialRight(String.slice, cssPrefix.length) }
								}
							),
							function(values, method) { $el[method](values); }
						);
					}

					utils.stream(_.keys(customAttrs), [ binders, customAttrs ], function(binder, values) {
						binder.apply(binder, [$el].concat(values));
					});
				}));

			return modelBinder;
		},

		bind: function (model, rootEl, bindings, options) {
			if (!model)  { this._throwException('model must be specified'); }
			if (!rootEl) { this._throwException('rootEl must be specified'); }

			this.unbind();

			rootEl = rootEl instanceof $ ? rootEl : $(rootEl);
			options = this._initOptions(options || {});

			var isEmpty = _.isEmpty(bindings);
			if (isEmpty || options.useDefaults) {
				var defaultBindings = ModelBinder.createDefaultBindings(rootEl, options.defaults);
				bindings = isEmpty ? defaultBindings : ModelBinder.mergeBindings(defaultBindings, bindings);
			}
			bindings = this._initElBindings(this._initAttrBindings(bindings), rootEl);

			this._model    = model;
			this._rootEl   = rootEl;
			this._bindings = bindings;
			this._options  = options;

			this._bindModelToView();
			this._bindViewToModel();

			switch (this._options.initialCopyDirection) {
				case CONST.ModelToView: this.toView();  break;
				case CONST.ViewToModel: this.toModel(); break;
				default: // do nothing
			}

			return this;
		},

		unbind: function () {
			if (this._model)  { this._unbindModelToView(); }
			if (this._rootEl) { this._unbindViewToModel(); }
			this._bindings = {};

			return this;
		},

		_initOptions: function (options) {
			options = $.extend(true, {}, defaultOptions, ModelBinder.options, options,
				// constant:
				{ modelSetOptions: { changeSource: 'ModelBinder' } }
			);

			// actually, more often we need only to add some more specific events instead of overriding defaults completely.
			if (options.skipDefaultTriggers) {
				options.changeTriggers = _.omit(options.changeTriggers, _.keys(defaultOptions.changeTriggers));
			}

			return options;
		},

		// Converts the input bindings, which might just be empty or strings, to binding objects
		_initAttrBindings: function (srcBindings) {

			function composeAttributeBindings(rawBindings, attrName) {
				var config = {
					modelAttr: attrName
				};

				config.bindings = _.map(
					// TODO: check for allowed types
					utils.ensureArray(_.isString(rawBindings) ? { selector: rawBindings } : rawBindings),
					composeElementBinding,
					config
				);

				return config;
			}

			function composeElementBinding(binding) {
				binding = $.extend(true, {
					parent: this, // context is attribute binding
					filters: {
						toView:  _.identity,
						toModel: _.identity
					},
					forceSync: true
				}, binding);

				if (!_.isObject(binding.elAttr)) {
					binding.elAttr = _.object(
						utils.ensureArray(binding.elAttr || 'value'),
						utils.resultMap(binding.elAttr, true)
					);
				}
				return binding;
			}

			return utils.updateValues(srcBindings, composeAttributeBindings, true);
		},

		_initElBindings: function (srcBindings, rootEl) {
			var attrName, attrBinding, elBinding, foundEls;

			for (attrName in srcBindings) {
				attrBinding = srcBindings[attrName];

				for (var i = 0; i < attrBinding.bindings.length; i++) {
					elBinding = attrBinding.bindings[i];
					// allow to pre-define bound els. Useful if default pre-created bindings are used
					if (elBinding.hasOwnProperty('boundEls')) { continue; }

					foundEls = elBinding.selector === ''
						? rootEl
						: $(elBinding.selector, rootEl);

					// TODO: allow empty 'dynamic' bindings?
					if (foundEls.length === 0) {
						this._throwException('Bad binding found. No elements returned for binding selector ' + elBinding.selector);
					} else {
						elBinding.boundEls = foundEls;
					}
				}
			}

			return srcBindings;
		},

		_bindModelToView: function () {
			this._model.on('change', this._onModelChange, this);
			return this;
		},

		_unbindModelToView: function () {
			this._model.off('change', this._onModelChange);
			this._model = undefined;

			return this;
		},

		_bindViewToModel: function () {
			this._configureRootElEvents('on');
			return this;
		},

		_unbindViewToModel: function () {
			this._configureRootElEvents('off');
			return this;
		},

		_configureRootElEvents: function(method) {
			var $el = this._rootEl,
				config = this._options.changeTriggers,
				selector, event;

			var args;
			for (selector in config) {
				event = config[selector];
				args = [event, this._onViewChange];
				if (!_.isEmpty(selector)) { args.splice(1, 0, selector); }
				$el[method].apply($el, args);
			}

			return this;
		},

		// ---------------------------------------------------------------

		_getBindingsForAttributes: function() {
			var binder = this;
			return _.pluck(
				arguments.length ? _.pick(binder._bindings, _.toArray(arguments)) : binder._bindings,
				'bindings'
			);
		},

		_getBindingsForElement: function (element) {
			var binder = this;
			return _.chain(binder._bindings)
				.pluck('bindings')
				.flatten(true)
				.filter(function(binding) { return binding.boundEls.is(element); })
				.value();
		},

		// ---------------------------------------------------------------

		toView: function() {
			var binder = this;
			_.chain(binder._getBindingsForAttributes.apply(binder, arguments))
				.flatten(true)
				.map(function(binding) {
					return binding.boundEls.map(function(index, elem) {
						if (!(binding._isSetting && elem._isSetting)) {
							return [ binding, binding.boundEls.eq(index) ]; // use eq, to get jQuery object, not pure DOM node
						}
					});
				})
				.flatten(true)
				.each(utils.arrayToArgs(binder._setView));
			return binder;
		},

		// TODO: what if several el bindings write value to same attribute?
		toModel: function () {
			var binder = this,
				readableBindings = _.chain(binder._getBindingsForAttributes.apply(binder, arguments)).filter(binder._isBindingReadable);

			readableBindings
				.reject(binder._isBindingRadioGroup)
				.map(function(binding) {
					var editableElements = binding.boundEls.filter(binder._isElementEditable);
					if (_.has(binding, 'read') || editableElements.length > 0) {
						return [binding, editableElements];
					}
				})
				.compact()
				.each(utils.arrayToArgs(binder._copyViewToModel));

			// TODO: resolve crazy radiogroups logic
			readableBindings
				.filter(binder._isBindingRadioGroup)
				.each(function(binding) {
					binding.boundEls.filter('input:radio:checked').each(function(index, elem) {
						binder._copyViewToModel(binding, binding.boundEls.eq(index));
					});
				});

			return this;
		},

		_onModelChange: function () {
			this.toView.apply(this, _.keys(this._model.changedAttributes()));
			return this;
		},

		_onViewChange: function (event) {
			var el = event.target,
				binder = this;

			// TODO: store trigger el in щио field, do not change el itself
			if (el._isSetting) { return this; }
			el._isSetting = true;

			_.chain(binder._getBindingsForElement(el))
				.filter(binder._isBindingReadable)
				.each(function(binding) {
					binder._copyViewToModel(binding, $(el));
				});

			el._isSetting = false;

			return binder;
		},

		_copyViewToModel: function (elBinding, $el) {
			elBinding._isSetting = true;
			if (this._setModel(elBinding, $el) && elBinding.forceSync && this._getConverter(CONST.ViewToModel, elBinding)) {
				this._setView(elBinding, $el);
			}
			elBinding._isSetting = false;

			return this;
		},

		_setModel: function (elBinding, $el) {
			var elVal = this._getElementValue(elBinding, $el);
			elVal = this._getConvertedValue(CONST.ViewToModel, elBinding, elVal);
			return this._model.set(elBinding.parent.modelAttr, elVal, this._options.modelSetOptions);
		},

		_setView: function (elBinding) {
			var binder   = this,
				binders  = binder.binders,
				bindings = elBinding.elAttr,
				$el      = elBinding.boundEls,
				values   = Array.prototype.slice.call(arguments, 1),

				getAttrValue       = function(previous) {
					return binder._getConvertedValue(CONST.ModelToView, elBinding,
						binder._model[previous ? 'previous' : 'get'](elBinding.parent.modelAttr)
					);
				},
				modelAttrValue     = getAttrValue(),
				prevModelAttrValue = getAttrValue(true),

				binderNames    = _.keys(bindings),
				cssAttrs       = _.filter(binderNames, function(name) { return name.slice(0, 4) === 'css:'; }),
				directAttrs    = _.difference(binderNames, _.keys(binders)),
				directBindings = _.chain(bindings).pick(directAttrs)
					.map(function(filter, name) { return [ name, binder._applyConverter(filter, modelAttrValue, elBinding) ]; })
					.object().value();

			$el.attr(_.omit(directBindings, cssAttrs))
				.css(_.pick(directBindings, cssAttrs));

			_.chain(bindings).omit(directAttrs).each(function(filter, binderName) {
				binders[binderName]($el,
					binder._applyConverter(filter, modelAttrValue,     elBinding),
					binder._applyConverter(filter, prevModelAttrValue, elBinding),
					elBinding
				);
			});

			return this;
		},

		_getElementValue: function (elBinding, $el) {
			var read = elBinding.read;
			if (read) {
				if (_.isString(read)) {
					return $el.attr(read);
				} else if (_.isFunction(read)) {
					return read.call(this, $el);
				} else if (_.isBoolean(read)) {
					// do nothing, drop to 'switch' below. Acts like 'force read'.
				} else {
					this._throwException('Unsupported type of option "read"');
					return undefined;
				}
			}

			switch ($el.attr('type')) {
				case 'checkbox':
					return $el.prop('checked');
				default:
					if ($el.attr('contenteditable') !== undefined) {
						return $el.html();
					} else {
						return $el.val();
					}
			}
		},

		_isBindingReadable: function (elBinding) {
			return elBinding.read || this._isBindingEditable(elBinding);
		},

		_isBindingEditable: function (elBinding) {
			return _.intersection(['value', 'text', 'html'], _.keys(elBinding.elAttr)).length > 0;
		},

		_isElementEditable: function ($el) {
			return $el.attr('contenteditable')
				|| $el.is('input')
				|| $el.is('select')
				|| $el.is('textarea');
		},

		_isBindingRadioGroup: function (elBinding) {
			var elements = elBinding.boundEls;
			return elements.filter('input:radio').length === elements.length;
		},

		_directionToKey: function(direction) {
			var result;
			switch (direction) {
				case CONST.ModelToView:
					result = 'toView';
					break;
				case CONST.ViewToModel:
					result = 'toModel';
					break;
				default:
					this._throwException('Unknown copy direction "' + direction + '"');
			}
			return result;
		},

		_getConverter: function(direction, binding, elAttr) {
			var binder          = this,
				converterName   = binder._directionToKey(direction),
				bindingFilter   = binding.filters[converterName] || binder._options.defaults.filters[converterName] || _.identity,
				attributeFilter = binding.elAttr[elAttr || 'value'];

			attributeFilter = (attributeFilter === true) ? _.identity : attributeFilter[converterName];
			return _.compose(attributeFilter, bindingFilter);
		},

		_getConvertedValue: function (direction, binding, elAttr, value) {
			var converter = this._getConverter(direction, binding, elAttr);
			return converter(value, binding.parent.modelAttr, this._model);
		},

		_applyConverter: function(converter, srcValue, binding) {
			return converter(srcValue, binding.parent.modelAttr, this._model);
		},

		_throwException: function (message) {
			if (this._options.suppressThrows) {
				if (console && console.error) {
					console.error(message);
				}
			} else {
				throw message;
			}
		}
	});

	ModelBinder.CollectionConverter = function (collection) {
		this._collection = collection;

		if (!this._collection) {
			throw 'Collection must be defined';
		}
		_.bindAll(this, 'convert');
	};

	_.extend(ModelBinder.CollectionConverter.prototype, {
		convert: function (direction, value) {
			if (direction === CONST.ModelToView) {
				return value ? value.id : undefined;
			} else {
				return this._collection.get(value);
			}
		}
	});

	/**
	 * A static helper function to create a default set of bindings that you can customize before calling the bind() function
	 * @param {Node|jQuery} rootEl  Where to find all of the bound elements
	 * @param {Object}      options Defines how to create bindings. Following keys are recognized:
	 *  - boundAttr - identifies elements that should be bound. Probably 'name' or 'id' in most cases
	 *  - converter(optional) - the default converter you want applied to all your bindings
	 *  - elAttr(optional) - the default elAttr you want applied to all your bindings
	 * @returns {Object}
	 */
	ModelBinder.createDefaultBindings = function (rootEl, options) {
		var bindingComponents = _.pick(options, 'filters', 'elAttr');

		function createSelector(attrValue) {
			return '[' + options.boundAttr + (attrValue ? ('="' + attrValue + '"' ) : '') + ']';
		}

		function getBoundAttr(elem) {
			return elem.getAttribute(options.boundAttr);
		}

		function composeBinding(elems, attrName) {
			return _.extend({
				boundEls: $(elems),
				selector: createSelector(attrName)
			}, bindingComponents);
		}

		return utils.updateValues(_.groupBy($(createSelector(), rootEl), getBoundAttr), composeBinding, true);
	};

	ModelBinder.mergeBindings = function (obj) {
		_.chain(arguments).toArray().slice(1).each(function(source) {
			var toMerge, existing;
			for (var attr in source) {
				existing = obj[attr];
				toMerge = source[attr];
				if (!existing) {
					obj[attr] = toMerge;
				} else {
					_.isArray(existing) ? existing.push(toMerge) : (existing = [existing].concat(toMerge));
				}
			}
		});
		return obj;
	};

	return ModelBinder;
}));