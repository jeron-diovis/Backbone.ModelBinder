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

		flattenArgs: function(args, position) {
			var proto = Array.prototype;
			position || (position = 0);
			return proto.concat.apply(proto, proto.slice.call(args, position));
		},

		updateValues: function(obj, mutator, updateExisting) {
			if (!updateExisting) {
				return _.object(_.keys(obj), _.map(obj, mutator));
			} else {
				_.each(obj, function(value, key, obj) {
					obj[key] = mutator(value, key, obj);
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

		toView: function() {
			var modelBinder = this,
				keys        = arguments.length > 0 ? utils.flattenArgs(arguments) : _.keys(modelBinder._bindings),
				bindings    = modelBinder._getBindingsForAttributes(keys),
				values      = modelBinder._fetchViewValuesFromModel(keys);

			_.chain(bindings).pluck('boundEls')
				.zip(_.map(bindings, function(binding) {
					return modelBinder._composeViewAttributesForBinding(binding, values[binding.parent.modelAttr]);
				}))
				.each(utils.arrayToArgs(modelBinder._updateView));

			return modelBinder;
		},

		toModel: function($element) {
			var modelBinder = this,
				model       = modelBinder._model,
				values      = _.map(
					modelBinder._getBindingsForElement($element),
					function(binding) {
						return modelBinder._composeModelAttributeForBinding(binding, $element);
					}
				);

			_.chain(values).groupBy(_.first).each(function(group, attrName) {
				var values = _.map(group, _.last);
				if (_.uniq(values).length > 1) {
					return modelBinder._throwException([
						'Configuration error: several bindings returns different value for the same model attribute.\n',
						'Model attribute: ', attrName, '\n',
						'Values: ', values.join(', '), '\n'
					].join(''));
				}
			});

			model.set(_.object(values), modelBinder._options.modelSetOptions);

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
						utils.ensureArray(utils.resultMap(binding.elAttr, true))
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

		// Find matching bindings:

		_getBindingsForAttributes: function(keys) {
			var binder = this;
			return _.chain(binder._bindings)
				[keys.length === 0 ? 'identity' : 'pick'](keys)
				.pluck('bindings')
				.flatten(true)
				//.groupBy(function(binding) { return binding.parent.modelAttr; })
				.value();
		},

		_getBindingsForElement: function(element) {
			var binder = this;
			return _.chain(binder._bindings)
				.pluck('bindings')
				.flatten(true)
				.filter(function(binding) { return binding.boundEls.is(element); })
				//.groupBy(function(binding) { return binding.parent.modelAttr; })
				.value();
		},

		// ---------------------------------------------------------------

		// TODO: what if several el bindings write value to same attribute?
		/*toModel: function () {
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
		},*/

		_onModelChange: function () {
			this.toView(_.keys(this._model.changedAttributes()));
			return this;
		},

		_onViewChange: function (event) {
			var el = event.target,
				binder = this;

			// TODO: store trigger el in щио field, do not change el itself
			if (el._isSetting) { return this; }
			el._isSetting = true;
			binder.toModel($(el));

			el._isSetting = false;

			return binder;
		},

		_getElementValue: function ($el, reader) {
			if (reader) {
				if (_.isString(reader)) {
					return $el.attr(reader);
				} else if (_.isFunction(reader)) {
					return reader.call(this, $el);
				} else if (_.isBoolean(reader)) {
					if (!this._isElementEditable($el)) {
						return this._throwException('Not editable element is forced to be read');
					}
					// otherwise do nothing, drop to 'switch' below. Acts like 'force read'.
				} else {
					return this._throwException('Unsupported type of option "read"');
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

		// ModelToView direction handlers:

		_fetchViewValuesFromModel: function() {
			var modelBinder = this,
				model       = modelBinder._model,
				keys        = utils.flattenArgs(arguments);

			return _.object(
				keys,
				_.zip(
					modelBinder._options.forceGet ? _.map(keys, model.get, model) : _.values(model.pick(keys)),
					_.map(keys, model.previous, model)
				)
			);
		},

		_composeViewAttributesForBinding: function(binding, values) {
			var modelBinder = this;

			return utils.updateValues(binding.elAttr, function(filter, attribute) {
				var converter = _.partial(modelBinder._getConvertedValue, CONST.ModelToView, binding, attribute);
				return _.has(modelBinder.binders, attribute) ? _.map(values, converter) : converter(values[0]);
			});
		},

		_updateView: function($element, valuesConfig) {
			var modelBinder = this,
				binders = modelBinder.binders,
				customBindersNames = _.keys(binders),

				customAttrs = valuesConfig,
				directAttrs = _.difference(_.keys(valuesConfig), customBindersNames),
				cssPrefix = 'css:',
				isCssAttr = function(str) { return str.slice(0, cssPrefix.length) === cssPrefix; };

			//debugger;

			if (directAttrs.length > 0) {
				customAttrs = _.omit(valuesConfig, directAttrs);
				directAttrs = _.pick(valuesConfig, directAttrs);

				_.map(
					utils.groupByObj(directAttrs,
						function(value, name) { return isCssAttr(name) ? 'css' : 'attr'; },
						{
							'css': { key: utils.partialRight(String.slice, cssPrefix.length) }
						}
					),
					function(values, method) {
						$element.each(function(index) {
							$element.eq(index)[method](values);
						});
					}
				);
			}

			utils.stream(_.keys(customAttrs), [ binders, customAttrs ], function(binder, values) {
				$element.each(function(index) {
					binder.apply(binder, [$element.eq(index)].concat(values));
				});
			});

			return modelBinder;
		},

		// ViewToModel direction handlers:

		_fetchModelValueFromView: function(binding, $element) {
			var modelBinder = this;
			return modelBinder._getConvertedValue(
				CONST.ViewToModel,
				binding,
				_.isString(binding.read) ? binding.read : null,
				modelBinder._getElementValue($element, binding.read)
			);
		},

		_composeModelAttributeForBinding: function(binding, $element, returnObject) {
			var modelBinder = this,
				config = [
					binding.parent.modelAttr,
					modelBinder._fetchModelValueFromView(binding, $element)
				];
			return returnObject ? _.object([config]) : config;
		},

		// Convertation:

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

		// ------------------------------------------------

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
					_.isArray(existing) ? existing.push(toMerge) : (obj[attr] = existing = [existing].concat(toMerge));
				}
			}
		});
		return obj;
	};

	return ModelBinder;
}));