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
			boundAttr: 'name'
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

	var ModelBinder = function () {
		_.bindAll.apply(_, [this].concat(_.functions(this)));

		this._attributeBindings = {};
		this._options = $.extend(true, {}, defaultOptions); // deep clone
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
			if (!model) this._throwException('model must be specified');
			if (!rootEl) this._throwException('rootEl must be specified');

			this.unbind();

			this._model = model;
			this._rootEl = rootEl instanceof $ ? rootEl : $(rootEl);
			this._options = this._initOptions(options || {});

			var defaultBindings = {};
			if (_.isEmpty(bindings) || options.useDefaults) {
				defaultBindings = this.constructor.createDefaultBindings(this._rootEl, this._options.defaults);
			}

			if (_.isEmpty(bindings)) {
				bindings = defaultBindings;
			} else {
				// TODO: maybe, need more smart merge
				bindings = _.extend(defaultBindings, bindings);
			}

			this._attributeBindings = this._initElBindings(this._initAttrBindings(bindings), this._rootEl);

			this._bindModelToView();
			this._bindViewToModel();

			return this;
		},

		unbind: function () {
			this._unbindModelToView();
			this._unbindViewToModel();

			delete this._attributeBindings;
			this._attributeBindings = {};

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

				// Add a linkage from the element binding back to the attribute binding
				for (var i = 0; i < attrBinding.elementBindings.length; i++) {
					attrBinding.elementBindings[i].attributeBinding = attrBinding;
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
					if (elBinding.hasOwnProperty('boundEls')) continue;

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

			if (this._options.initialCopyDirection === CONST.ModelToView) {
				this.copyModelAttributesToView();
			}

			return this;
		},

		_unbindModelToView: function () {
			if (!this._model)  return false;

			this._model.off('change', this._onModelChange);
			this._model = undefined;

			return this;
		},

		_bindViewToModel: function () {
			this._configureRootElEvents('on');

			if (this._options.initialCopyDirection === CONST.ViewToModel) {
				this.copyViewValuesToModel();
			}

			return this;
		},

		_unbindViewToModel: function () {
			this._configureRootElEvents('off');
			return this;
		},

		_configureRootElEvents: function(method) {
			var $el = this._rootEl;
			if (!$el) return false;

			var selector, event, config = this._options.changeTriggers;

			var args;
			for (selector in config) {
				event = config[selector];
				args = selector ? [event, selector, this._onElChanged] : [event, this._onElChanged];
				$el[method].apply($el, args);
			}

			return this;
		},

		// attributesToCopy is an optional parameter - if empty, all attributes
		// that are bound will be copied.  Otherwise, only attributeBindings specified
		// in the attributesToCopy are copied.
		copyModelAttributesToView: function () {
			var attrName, binding;

			var attributesToCopy = arguments.length === 0 ? null : _.toArray(arguments);

			for (attrName in this._attributeBindings) {
				if (!(attributesToCopy === null || _.indexOf(attributesToCopy, attrName) !== -1)) continue;

				binding = this._attributeBindings[attrName];
				this._copyModelToView(binding);
			}

			return this;
		},

		copyViewValuesToModel: function () {
			var attrName, attrBinding, elBinding, $el;

			var attributesToCopy = arguments.length === 0 ? null : _.toArray(arguments);

			for (attrName in this._attributeBindings) {
				if (!(attributesToCopy === null || _.indexOf(attributesToCopy, attrName) !== -1)) continue;

				attrBinding = this._attributeBindings[attrName];

				// TODO: what is several el bindings write value to same attribute?
				for (var i = 0; i < attrBinding.elementBindings.length; i++) {
					elBinding = attrBinding.elementBindings[i];

					// TODO: need also to apply 'read' option
					if (!(this._isBindingUserEditable(elBinding) || elBinding.read)) continue;

					if (this._isBindingRadioGroup(elBinding)) {
						$el = this._getRadioButtonGroupCheckedEl(elBinding);
						if ($el) {
							this._copyViewToModel(elBinding, $el);
						}
					} else {
						for (var j = 0; j < elBinding.boundEls.length; j++) {
							$el = elBinding.boundEls.eq(j);
							if (this._isElUserEditable($el) || elBinding.read) {
								this._copyViewToModel(elBinding, $el);
							}
						}
					}
				}
			}

			return this;
		},

		_onElChanged: function (event) {
			var el, elBindings, elBinding;

			el = event.target;
			elBindings = this._getElBindings(el);

			for (var i = 0; i < elBindings.length; i++) {
				elBinding = elBindings[i];
				if (this._isBindingUserEditable(elBinding) || elBinding.read) {
					this._copyViewToModel(elBinding, el);
				}
			}

			return this;
		},

		_onModelChange: function () {
			_.chain(this._attributeBindings)
				.pick(_.keys(this._model.changedAttributes()))
				.each(this._copyModelToView);

			return this;
		},

		_copyModelToView: function (attrBinding) {
			var i, j, elBinding, boundEl, value, convertedValue;

			value = this._model.get(attrBinding.attributeName);

			for (i = 0; i < attrBinding.elementBindings.length; i++) {
				elBinding = attrBinding.elementBindings[i];

				for (j = 0; j < elBinding.boundEls.length; j++) {
					boundEl = elBinding.boundEls.eq(j);
					if (elBinding._isSetting && boundEl.get(0)._isSetting) continue; // TODO: resolve a crutch with _isSetting

					convertedValue = this._getConvertedValue(CONST.ModelToView, elBinding, value);
					this._setEl(boundEl, elBinding, convertedValue);
				}
			}

			return this;
		},

		_copyViewToModel: function (elementBinding, el) {
			var result, value, convertedValue, $el;

			if (el instanceof $) {
				$el = el;
				el = $el.get(0);
			} else {
				$el = $(el);
			}

			// TODO: store trigger el in щио field, do not change el itself
			if (el._isSetting) return this;

			el._isSetting = true;
			elementBinding._isSetting = true;

			result = this._setModel(elementBinding, $el);

			el._isSetting = false;
			elementBinding._isSetting = false;

			var elVal = this._getElValue(elementBinding, $el);
			var isViewValueConverted = !_.isEqual(elVal, this._getConvertedValue(CONST.ViewToModel, elementBinding, elVal));

			var isForceSync = (elementBinding.forceSync || !_.has(elementBinding, 'forceSync'));

			if (isViewValueConverted && isForceSync && result) {
				value = this._model.get(elementBinding.attributeBinding.attributeName);
				convertedValue = this._getConvertedValue(CONST.ModelToView, elementBinding, value);
				this._setEl($el, elementBinding, convertedValue);
			}

			return this;
		},

		_setModel: function (elBinding, $el) {
			var elVal = this._getElValue(elBinding, $el);
			elVal = this._getConvertedValue(CONST.ViewToModel, elBinding, elVal);
			return this._model.set(elBinding.attributeBinding.attributeName, elVal, this._options.modelSetOptions);
		},

		_setEl: function ($el, elBinding, convertedValue) {
			if (elBinding.elAttr) {
				this._setElAttribute($el, elBinding, convertedValue);
			} else {
				this._setElValue($el, convertedValue);
			}

			return this;
		},

		_setElAttribute: function ($el, elBinding, convertedValue) {
			switch (elBinding.elAttr) {
				case 'html':
					$el.html(convertedValue);
					break;
				case 'text':
					$el.text(convertedValue);
					break;
				case 'enabled':
					$el.prop('disabled', !convertedValue);
					break;
				case 'disabled':
					$el.prop('disabled', convertedValue);
					break;
				case 'displayed':
					$el[convertedValue ? 'show' : 'hide']();
					break;
				case 'hidden':
					$el[convertedValue ? 'hide' : 'show']();
					break;
				case 'css':
					$el.css(elBinding.cssAttribute, convertedValue);
					break;
				case 'class':
					var previousValue = this._model.previous(elBinding.attributeBinding.attributeName);
					var currentValue = this._model.get(elBinding.attributeBinding.attributeName);
					// is current value is now defined then remove the class the may have been set for the undefined value
					if (!_.isUndefined(previousValue) || !_.isUndefined(currentValue)) {
						previousValue = this._getConvertedValue(CONST.ModelToView, elBinding, previousValue);
						$el.removeClass(previousValue);
					}

					if (convertedValue) {
						$el.addClass(convertedValue);
					}
					break;
				default:
					$el.attr(elBinding.elAttr, convertedValue);
			}

			return this;
		},

		_setElValue: function ($el, convertedValue) {
			if ($el.attr('type')) {
				switch ($el.attr('type')) {
					case 'radio':
						if ($el.val() === convertedValue) {
							// must defer the change trigger or the change will actually fire with the old value
							/*el.prop('checked') || _.defer(function () {
								el.trigger('change');
							});*/
							$el.prop('checked', true);
						}
						else {
							$el.prop('checked', false);
						}
						break;
					case 'checkbox':
						// must defer the change trigger or the change will actually fire with the old value
						/*el.prop('checked') === !!convertedValue || _.defer(function () {
							el.trigger('change')
						});*/
						$el.prop('checked', !!convertedValue);
						break;
					case 'file':
						break;
					default:
						$el.val(convertedValue);
				}
			} else {
				var value = convertedValue || (convertedValue === 0 ? '0' : '');
				if ($el.is('input') || $el.is('select') || $el.is('textarea')) {
					$el.val(value);
				} else {
					$el.text(value);
				}
			}

			return this;
		},

		_getElValue: function (elementBinding, $el) {
			var read = elementBinding.read;
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

		_isBindingUserEditable: function (elBinding) {
			return elBinding.elAttr === undefined ||
				elBinding.elAttr === 'text' ||
				elBinding.elAttr === 'html';
		},

		_isElUserEditable: function ($el) {
			var isContentEditable = $el.attr('contenteditable');
			return isContentEditable || $el.is('input') || $el.is('select') || $el.is('textarea');
		},

		_isBindingRadioGroup: function (elBinding) {
			var elements = elBinding.boundEls;
			return elements.filter('input:radio').length === elements.length;
		},

		_getRadioButtonGroupCheckedEl: function (elBinding) {
			var $el = elBinding.boundEls.filter('input:radio:checked');
			return $el.length > 0 ? $el : null;
		},

		_getElBindings: function (findEl) {
			return _.chain(this._attributeBindings)
				.pluck('elementBindings')
				.flatten(true)
				.filter(function(binding) { return binding.boundEls.is(findEl); })
				.value();
		},

		_getConvertedValue: function (direction, elBinding, value) {
			var converter = elBinding.converter || this._options.converter;
			if (converter) {
				value = converter(direction, value, elBinding.attributeBinding.attributeName, this._model, elBinding.boundEls);
			}
			return value;
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
		var bindingComponents = _.pick(options, 'converter', 'elAttr');

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

	// Helps you to combine 2 sets of bindings
	ModelBinder.combineBindings = function (destination, source) {
		_.each(source, function (value, key) {
			var elementBinding = {selector: value.selector};

			if (value.converter) {
				elementBinding.converter = value.converter;
			}

			if (value.elAttr) {
				elementBinding.elAttr = value.elAttr;
			}

			if (!destination[key]) {
				destination[key] = elementBinding;
			}
			else {
				destination[key] = [destination[key], elementBinding];
			}
		});

		return destination;
	};

	return ModelBinder;
}));