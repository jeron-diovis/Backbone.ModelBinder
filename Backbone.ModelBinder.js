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
		useDefaults: false
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

	var filters = {};

	var utils = {
		resultArray: function(value) {
			return _.isArray(value) ? value : [value];
		},

		resultMap: function(value, mapValue) {
			return _.isArray(value) ? _.map(value, function() { return mapValue; }) : mapValue;
		},

		arrayToArgs: function(func) {
			return function(argsArray) {
				return func.apply(this, argsArray);
			};
		}
	};

	var ModelBinder = function () {
		_.bindAll.apply(_, [this].concat(_.functions(this)));

		this._bindings = {};
		this._options = $.extend(true, {}, defaultOptions); // deep clone
		this.binders = _.clone(defaultBinders);
		this.filters = _.clone(filters);
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

		bind: function (model, rootEl, bindings, options) {
			if (!model)  { this._throwException('model must be specified'); }
			if (!rootEl) { this._throwException('rootEl must be specified'); }

			this.unbind();

			this._model = model;
			this._rootEl = rootEl instanceof $ ? rootEl : $(rootEl);
			this._options = this._initOptions(options || {});

			var isEmpty = _.isEmpty(bindings);
			if (isEmpty || options.useDefaults) {
				var defaultBindings = ModelBinder.createDefaultBindings(this._rootEl, this._options.defaults);
				bindings = isEmpty ? defaultBindings : ModelBinder.mergeBindings(defaultBindings, bindings);
			}

			this._bindings = this._initElBindings(this._initAttrBindings(bindings), this._rootEl);

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

			delete this._bindings;
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
			var attrName, inputBinding, attrBinding;

			for (attrName in srcBindings) {
				inputBinding = srcBindings[attrName];

				if (_.isString(inputBinding)) {
					attrBinding = {
						elementBindings: [
							{ selector: inputBinding }
						]
					};
				} else if (_.isArray(inputBinding)) {
					attrBinding = { elementBindings: inputBinding };
				} else if (_.isObject(inputBinding)) {
					attrBinding = { elementBindings: [inputBinding] };
				} else {
					this._throwException('Unsupported type passed to Model Binder: ' + inputBinding);
				}

				for (var i = 0; i < attrBinding.elementBindings.length; i++) {
					var elBinding = attrBinding.elementBindings[i];

					// Add a linkage from the element binding back to the attribute binding
					elBinding.attributeBinding = attrBinding;

					_.defaults(elBinding, {
						filters: {},
						forceSync: true
					});

					if (!_.isObject(elBinding.elAttr)) {
						elBinding.elAttr = _.object(
							utils.resultArray(elBinding.elAttr || 'value'),
							utils.resultMap(elBinding.elAttr, true)
						);
					}
				}

				attrBinding.attributeName = attrName;
				srcBindings[attrName] = attrBinding;
			}

			return srcBindings;
		},

		_initElBindings: function (srcBindings, rootEl) {
			var attrName, attrBinding, elBinding, foundEls;

			for (attrName in srcBindings) {
				attrBinding = srcBindings[attrName];

				for (var i = 0; i < attrBinding.elementBindings.length; i++) {
					elBinding = attrBinding.elementBindings[i];
					// allow to pre-define bound els. Useful if default pre-created bindings are used
					if (elBinding.hasOwnProperty('boundEls')) { continue; }

					foundEls = elBinding.selector === ''
						? rootEl
						: $(elBinding.selector, rootEl);

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

		toView: function() {
			var binder = this;
			_.chain(binder._bindings)[arguments.length ? 'pick' : 'identity'](_.toArray(arguments))
				.pluck('elementBindings')
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
				readableBindings = _.chain(binder._bindings)[arguments.length ? 'pick' : 'identity'](_.toArray(arguments))
					.pluck('elementBindings')
					.filter(binder._isBindingReadable);

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
			return this._model.set(elBinding.attributeBinding.attributeName, elVal, this._options.modelSetOptions);
		},

		_setView: function (elBinding, $el) {
			var binder   = this,
				binders  = binder.binders,
				bindings = elBinding.elAttr,

				getAttrValue       = function(previous) {
					return binder._getConvertedValue(CONST.ModelToView, elBinding,
						binder._model[previous ? 'previous' : 'get'](elBinding.attributeBinding.attributeName)
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
			return $el.attr('contenteditable') || $el.is('input') || $el.is('select') || $el.is('textarea');
		},

		_isBindingRadioGroup: function (elBinding) {
			var elements = elBinding.boundEls;
			return elements.filter('input:radio').length === elements.length;
		},

		_getBindingsForElement: function (element) {
			return _.chain(this._bindings)
				.pluck('elementBindings')
				.flatten(true)
				.filter(function(binding) { return binding.boundEls.is(element); })
				.value();
		},

		_getConverter: function(direction, elBinding) {
			var converterName = direction === CONST.ModelToView ? 'toView' : 'toModel';
			return elBinding.filters[converterName] || this._options.defaults.filters[converterName];
		},

		_getConvertedValue: function (direction, elBinding, value) {
			var converter = this._getConverter(direction, elBinding);
			return !converter ? value : this._applyConverter(converter, value, elBinding);
		},

		_applyConverter: function(converter, sourceValue, binding) {
			return converter === true ? sourceValue : converter(sourceValue, binding.attributeBinding.attributeName, this._model, binding.boundEls);
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
			var parts = ['[', options.boundAttr, ']'];
			if (attrValue) {
				parts.splice(-1, 0, '=', '"', attrValue, '"');
			}
			return parts.join('');
		}

		function getBoundAttr(elem) {
			return elem.getAttribute(options.boundAttr);
		}

		function createBinding(elems, attrName) {
			return [
				attrName,
				_.extend({
					boundEls: $(elems),
					selector: createSelector(attrName)
				}, bindingComponents)
			];
		}

		return _.chain($(createSelector(), rootEl)).groupBy(getBoundAttr).map(createBinding).object().value();
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