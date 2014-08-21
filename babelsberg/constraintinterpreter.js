module('users.timfelgentreff.babelsberg.constraintinterpreter').requires('users.timfelgentreff.jsinterpreter.Interpreter', 'cop.Layers', 'users.timfelgentreff.babelsberg.cassowary_ext', 'users.timfelgentreff.babelsberg.deltablue_ext', 'users.timfelgentreff.babelsberg.csp_ext', 'users.timfelgentreff.babelsberg.core_ext', 'users.timfelgentreff.babelsberg.src_transform', 'users.timfelgentreff.babelsberg.babelsberg-lively').toRun(function() {

/**
 * The interface to create, maintain and remove constraints.
 * @class Babelsberg
 */
Object.subclass("Babelsberg", {

    initialize: function () {
        this.defaultSolvers = [];
    },

    isConstraintObject: function () {
        return true;
    },
    
	/**
	 * Removes the listener on the given property of the given object.
	 * @function Babelsberg#unconstrain
	 * @public
	 * @param {Object} obj The object whose property should be unconstrained.
	 * @param {string} accessor The name of the property to be unconstrained.
	 */
    unconstrain: function (obj, accessor) {
        if (!obj) return;
        var cvar = ConstrainedVariable.findConstraintVariableFor(obj, accessor);
        if (!cvar) return;
        var cGetter = obj.__lookupGetter__(accessor),
            cSetter = obj.__lookupSetter__(accessor);
        if (!cGetter && !cSetter) {
            return;
        }
        if (!cGetter.isConstraintAccessor || !cSetter.isConstraintAccessor) {
            throw "too many accessors - unconstrain only works for the very simple case now"
        }
        ConstrainedVariable.deleteConstraintVariableFor(obj, accessor);
        var newName = cvar.newIvarname;
        var existingSetter = obj.__lookupSetter__(newName),
            existingGetter = obj.__lookupGetter__(newName);
        if (existingGetter) {
            obj.__defineGetter__(this.accessor, existingGetter);
        }
        if (existingSetter) {
            obj.__defineSetter__(this.accessor, existingSetter);
        }
        if (!existingSetter || !existingGetter) {
            delete obj[accessor];
        }
        obj[accessor] = obj[newName];
        delete obj[newName]
        
        // recursive unconstrain
        var child = obj[accessor];
        bbb.unconstrainAll(child);
    },
    
	/**
	 * Removes all listener on the given object.
	 * @function Babelsberg#unconstrainAll
	 * @public
	 * @param {Object} obj The object whose property should be unconstrained.
	 */
    unconstrainAll: function (obj) {
        if(obj && obj instanceof Object) {
            Object.keys(obj).each(function(property, index) {
                var cvar = ConstrainedVariable.findConstraintVariableFor(obj, property);
                if (!cvar) return;
                var cGetter = obj.__lookupGetter__(property),
                    cSetter = obj.__lookupSetter__(property);
                if (!cGetter && !cSetter) return;
                if (!cGetter.isConstraintAccessor || !cSetter.isConstraintAccessor) return;
                
                bbb.unconstrain(obj, property);
            });
        }
    	
    },
    
	/**
	 * Some solvers, like Cassowary and DeltaBlue, handle assignments by using temporary constraint that reflects the assignments. The creation and deletion of these constraints can be costly if assignments are done frequently. The edit function is one way to deal with this issue. Use it on attributes that are frequently modified for better performance.
	 * @function Babelsberg#edit
	 * @public
	 * @param {Object} obj An object that is modified quite often.
	 * @param {string[]} accessors The property names of the properties that are modified.
	 * @returns {function} A callback that can be used to assign new values to the given properties.
	 * @example Example usage of bbb.edit
	 * var s = new DBPlanner(),
	 *     obj = {int: 42, str: "42"};
     * 
	 * // Keep the attributes 'str' and 'int' in sync.
	 * bbb.always({
	 *     solver: deltablue,
	 *     ctx: {
	 *         obj: obj
	 *     }, methods: function() {
	 *         obj.int.formula([obj.str], function (str) { return parseInt(str); });
	 *         obj.str.formula([obj.int], function (int) { return int + ""; })
	 *     }
	 * }, function () {
	 *     return obj.int + "" === obj.str;
	 * });
     * 
     * // Create an edit constraint for frequent assignments on obj.int.
     * var callback = bbb.edit(obj, ["int"]);
     * // Assign 17 as the new value of obj.int. Constraints are solved automatically.
     * callback([17]);
	 */
    edit: function (obj, accessors) {
        var extVars = {},
            cVars = {},
            extConstraints = [],
            solvers = [],
            callback = function (newObj) {
                if (!newObj) { // end-of-edit
                    for (var prop in extVars) {
                        extVars[prop].each(function (evar) {
                            evar.finishEdit();
                        });
                    }
                    solvers.invoke("endEdit");
                } else {
                    var newEditConstants = newObj;
                    if (!Object.isArray(newObj)) {
                        newEditConstants = accessors.map(function (accessor) {
                            return newObj[accessor];
                        });
                    }
                    solvers.invoke("resolveArray", newEditConstants);
                    accessors.each(function (a) {
                        cVars[a].suggestValue(cVars[a].externalValue);
                        // extVars[a] = extVars[a]; // set the value,
                                                 // propagates change to other property accessors
                                                 // calls the setters
                                                 // does not recurse into solvers, because they have already
                                                 // adopted the correct value
                    })
                }
            };

        accessors.each(function (accessor) {
            var cvar = ConstrainedVariable.findConstraintVariableFor(obj, accessor);
            if (!cvar) {
                throw "Cannot edit " + obj + '["' + accessor + '"], because it isn\'t constrained'
            }
            var evars = Properties.values(cvar._externalVariables);
            if (evars.compact().length < evars.length) {
                throw "Cannot edit " + obj + '["' + accessor + '"], because it is in a recalculate relation'
            }
            if (cvar.solvers.any(function (s) { return !Object.isFunction(s.beginEdit) })) {
                throw "Cannot edit " + obj + '["' + accessor + '"], because it is in a no-edit solver'
            }
            cVars[accessor] = cvar;
            extVars[accessor] = evars;
            solvers = solvers.concat(cvar.solvers).uniq();
            evars.each(function (evar) {
                evar.prepareEdit();
            });
        });

        solvers.invoke("beginEdit");
        return callback;
    },
	
	/**
	 * Marks the given object as readonly. This functionality is only supported for some solvers.
	 * @function Babelsberg#readonly
	 * @public
	 * @param {Object} obj The object that should not be modified.
	 * @example Example usage of bbb.readonly
	 * var s = new ClSimplexSolver(),
	 *     pt = {x: 1, y: 2, z: 3};
     * 
	 * // The x and y coordinate of the point should sum up to its z coordinate.
	 * // Cassowary is not allowed to change the value of pt.z in order to fulfil this constraint.
	 * bbb.always({
	 *     solver: s,
	 *     ctx: {
	 *         pt: pt,
	 *         ro: bbb.readonly,
	 *         _$_self: this.doitContext || this
	 *     }
	 * }, function() {
	 *     return pt.x + ro(pt.y) == pt.z;;
	 * });
     * 
	 * // This assignment cannot modify pt.y, but rather changes pt.z
	 * pt.x = 4;
	 */
    readonly: function(obj) {
        if (obj.isConstraintObject) {
            obj.setReadonly(true);
        } else {
            if (Constraint.current && Constraint.current.solver) {
                Properties.own(obj).each(function (ea) {
                    var cvar = ConstrainedVariable.newConstraintVariableFor(obj, ea);
                    cvar.addToConstraint(Constraint.current);
                    cvar.ensureExternalVariableFor(Constraint.current.solver);
                    if (cvar.isSolveable()) {
                        bbb.readonly(cvar.externalVariables(Constraint.current.solver))
                    }
                });
            }
        }
        return obj;
    },

	/**
	 * Creates a constraint equivalent to the given function.
	 * @function Babelsberg#always
	 * @public
	 * @param {Object} opts An options object to configure the constraint construction.
	 * @param {Object} opts.ctx The local scope in which the given function is executed.
	 * @param {Object} [opts.solver] The solver to maintain the constraint.
	 * @param {boolean} [opts.allowTests=false] If true, allows to specify assertions rather than solvable constraints.
	 * @param {boolean} [opts.allowUnsolvableOperations=false] If true, allows the use of operations that are not supported by the solver.
	 * @param {boolean} [opts.debugging=false] If true, calls debugger at certain points during constraint construction.
	 * @param {function} func The constraint to be fulfilled.
	 */
    always: function(opts, func) {
        var solver = opts.solver || this.defaultSolver;
        func.allowTests = (opts.allowTests === true);
        func.allowUnsolvableOperations = (opts.allowUnsolvableOperations === true);
        func.debugging = opts.debugging;
        
        if (!solver) { // throw "Must explicitely pass a solver for now";
            var constraint,
                errors = [];
            bbb.defaultSolvers.some(function (solver) {
                try {
                    constraint = solver.always(opts, func);
                    return true;
                } catch(e) {
                    errors.push("\n" + solver.constructor.name + ": " + e);
                    return false;
                }
            });
            if (!constraint) {
                throw new Error("Must explicitely pass a solver for this constraint. The errors for the tried solvers were:" + errors);
            } else {
                return constraint;
            }
        } else {
            return solver.always(opts, func);
        }
        return solver.always(opts, func);
    }

});
Object.extend(Global, {
	/**
	 * A globally accessible instance of {@link Babelsberg}
	 * @global
	 */
    bbb: new Babelsberg()
});

users.timfelgentreff.jsinterpreter.Send.addMethods({
    get args() {
        return this._$args || []
    },
    
    set args(value) {
        this._$args = value
    }
});

cop.create("ConstraintConstructionLayer").refineObject(users.timfelgentreff.jsinterpreter, {
    get InterpreterVisitor() {
        return ConstraintInterpreterVisitor;
    }
}).refineClass(users.timfelgentreff.jsinterpreter.Send, {
    asFunction: function(optFunc) {
        var initializer = optFunc.prototype.initialize.ast().asFunction();
        initializer.original = optFunc;
        return initializer;
    }
}).refineClass(users.timfelgentreff.jsinterpreter.GetSlot, {
    set: function(value, frame, interpreter) {
        var obj = interpreter.visit(this.obj),
            name = interpreter.visit(this.slotName);
        if (obj === Global || (obj instanceof lively.Module)) {
            return obj[name] = value;
        }
        if (obj && obj.isConstraintObject) {
            obj = this.getConstraintObjectValue(obj);
        }
        
        obj[name] = value;
        cvar = ConstrainedVariable.newConstraintVariableFor(obj, name);
        if (Constraint.current) {
            cvar.ensureExternalVariableFor(Constraint.current.solver);
            cvar.addToConstraint(Constraint.current);
            if (cvar.isSolveable()) {
                Constraint.current.addPrimitiveConstraint(cvar.externalVariable.cnEquals(value));
            }
        }
    },
});

/**
 * Represents an invariant.
 * @class Constraint
 */
Object.subclass('Constraint', {
    initialize: function(predicate, solver) {
        this._enabled = false;
        this._predicate = predicate;
        this.constraintobjects = [];
        this.constraintvariables = [];
        this.solver = solver;

        // FIXME: this global state is ugly
        try {
            Constraint.current = this;
            var constraintObject = cop.withLayers([ConstraintConstructionLayer], function () {
                return predicate.forInterpretation().apply(undefined, []);
            });
        } finally {
            Constraint.current = null;
        }
        this.addPrimitiveConstraint(constraintObject); //// isn't constraintObject always undefined in this scope?
    },
    addPrimitiveConstraint: function(obj) {
        if (typeof(obj) != "undefined" && !this.constraintobjects.include(obj)) {
            if (!obj.enable) this.haltIfDebugging();
            this.constraintobjects.push(obj);
        }
    },
    addConstraintVariable: function(v) {
        if (v && !this.constraintvariables.include(v)) {
            this.constraintvariables.push(v);
        }
    },



    get predicate() {
        return this._predicate;
    },
    get allowUnsolvableOperations() {
        this.haltIfDebugging();
        return !!this.predicate.allowUnsolvableOperations;
    },
    haltIfDebugging: function() {
        if (this.predicate.debugging) debugger;
    },
    get allowTests() {
        this.haltIfDebugging();
        return !!this.predicate.allowTests;
    },

    get priority() {
        return this._priority;
    },

    set priority(value) {
        var enabled = this._enabled;
        if (enabled) {
            this.disable();
        }
        this._priority = value;
        if (enabled) {
            this.enable();
        }
    },

    get value() {
        return this.constraintobjects.last();
    },

	/**
	 * Enables this constraint. This is done automatically after constraint construction by most solvers.
	 * @function Constraint#enable
	 * @public
	 */
    enable: function() {
        if (!this._enabled) {
            this.constraintobjects.each(function (ea) {
                this.enableConstraintObject(ea);
            }.bind(this));
            if (this.constraintobjects.length === 0) {
                throw new Error("BUG: No constraintobjects were created.");
            }
            this._enabled = true;
            this.solver.solve();
        }
    },

    enableConstraintObject: function(obj, optPriority) {
        if (obj === true) {
            if (this.allowTests) {
                alertOK("Warning: Constraint expression returned true. Re-running whenever the value changes");
            } else {
                throw new Error("Constraint expression returned true, but was not marked as test. If you expected this to be solveable, check that there are no operations in this that cannot be solved by the selected solver (e.g. Cassowary does not support `<', only `<='). Otherwise, if you think this is ok, you must pass `allowTests: true' as option to the constraint.");
            }
        } else if (obj === false) {
            throw new Error("Constraint expression returned false, no solver available to fix it");
        } else if (!obj.enable) {
            var e = new Error("Constraint expression returned an object that does not respond to #enable");
            e.obj = obj;
            e.constraint = this;
            throw e
        } else {
            obj.solver = this.solver; // XXX: Bit of a hack, should really write it so
                                      // this gets passed through from the variables
            obj.enable(optPriority || this._priority);
        }
    },

	/**
	 * Disables this constraint. It is not further maintained until its {@link Constraint#enable|re-enabling}.
	 * @function Constraint#disable
	 * @public
	 */
    disable: function() {
        if (this._enabled) {
            this.constraintobjects.each(function (ea) {
                try {ea.disable()} catch(e) {}
            });
            this._enabled = false;
        }
    },

    recalculate: function() {
        // TODO: Fix this so it uses the split-stay result, i.e. just increase the stay for the newly assigned value
        var enabled = this._enabled,
            cvars = this.constraintvariables,
            self = this,
            assignments;
        if (enabled) {
            this.disable();
        }
        this.initialize(this.predicate, this.solver);

        cvars.select(function (ea) {
            // all the cvars that are not in this constraint anymore
            return !this.constraintvariables.include(ea) && ea.isSolveable();
        }.bind(this)).each(function (ea) {
            return ea.externalVariable.removeStay();
        });

        if (enabled) {
            assignments = this.constraintvariables.select(function (ea) {
                // all the cvars that are new after this recalculation
                return !cvars.include(ea) && ea.isSolveable();
            }).collect(function (ea) {
                // add a required constraint for the new variable
                // to keep its new value, to have the same semantics
                // as for direct assignment
                return ea.externalVariable.cnIdentical(ea.getValue());
            });

            assignments.each(function (ea) {
                try {
                    self.enableConstraintObject(ea);
                } catch(_) { // if the assignment cannot be completely satisfied, make it strong
                    self.enableConstraintObject(ea, self.solver.strength.strong);
                }
            });

            try {
                // try to enable this constraints with (some) required assignments
                this.enable();
            } catch(_) {
                // if it fails, disable, make all the assignments only strong, re-enable
                this._enabled = true; // force disable to run
                this.disable();
                assignments.invoke("disable");
                assignments.invoke("enable", this.solver.strength.strong);
                this.enable();
            } finally {
                assignments.invoke("disable");
            }
        }
    },
});
Object.extend(Constraint, {
    set current(p) {
        if (!this._previous) {
            this._previous = []
        }
        if (p === null) {
            if (this._previous.length > 0) {
                this._current = this._previous.pop();
            } else {
                this._current = null;
            }
            return;
        }
        if (this._current) {
            this._previous.push(this._current);
        }
        this._current = p;
    },

    get current() {
        return this._current;
    },

});
Object.subclass('ConstrainedVariable', {
    initialize: function(obj, ivarname, optParentCVar) {
        this.obj = obj;
        this.ivarname = ivarname;
        this.newIvarname = "$1$1" + ivarname;
        this.parentConstrainedVariable = optParentCVar;
        this._constraints = [];
        this._externalVariables = {};
        var value = obj[ivarname],
            solver = this.currentSolver;

        dbgOn(!solver)
        this.ensureExternalVariableFor(solver);

        var existingSetter = obj.__lookupSetter__(this.ivarname),
            existingGetter = obj.__lookupGetter__(this.ivarname);

        if (existingGetter && !existingGetter.isConstraintAccessor) {
            obj.__defineGetter__(this.newIvarname, existingGetter);
        }
        if (existingSetter && !existingSetter.isConstraintAccessor) {
            obj.__defineSetter__(this.newIvarname, existingSetter);
        }
        // assign old value to new slot
        if (!existingGetter && !existingSetter && this.obj.hasOwnProperty(this.ivarname)) {
            this.setValue(obj[ivarname]);
        }

        try {
            obj.__defineGetter__(ivarname, function() {
                return this.getValue();
            }.bind(this));
        } catch (e) { /* Firefox raises for Array.length */ }
        var newGetter = obj.__lookupGetter__(this.ivarname);
        if (!newGetter) {
            // Chrome silently ignores __defineGetter__ for Array.length
            this.externalVariables(solver, null);
            return;
        }

        obj.__defineSetter__(ivarname, function(newValue) {
            return this.suggestValue(newValue, "source");
        }.bind(this));
        var newSetter = obj.__lookupSetter__(this.ivarname);

        if (newSetter) newSetter.isConstraintAccessor = true;
        if (newGetter) newGetter.isConstraintAccessor = true;
    },
    ensureExternalVariableFor: function(solver) {
        var eVar = this.externalVariables(solver),
            value = this.obj[this.ivarname];

        this.cachedDefiningSolver = null;
        this.cachedDefiningVar = null;
        if (!eVar && eVar !== null) { // don't try to create an external variable twice
            this.externalVariables(solver, solver.constraintVariableFor(value, this.ivarname, this));
        }
    },



    get currentSolver() {
        if (Constraint.current) {
            return Constraint.current.solver;
        } else {
            return null;
        }
    },

    suggestValue: function(value, source) {
        if (ConstrainedVariable.$$callingSetters) {
	        return value;
        }

        if (value !== this.storedValue) {
            var callSetters = !ConstrainedVariable.$$optionalSetters;
            var priorValue = this.storedValue;
            ConstrainedVariable.$$optionalSetters = ConstrainedVariable.$$optionalSetters || [];
            try {
                if (this.isSolveable() && !ConstrainedVariable.isSuggestingValue) {
                    var wasReadonly = false,
                        eVar = this.definingExternalVariable,
                        solver = this.definingSolver;
                    try {
                        if (solver && source) {
                            solver.weight += 987654321; // XXX Magic Number
                            this.findTransitiveConnectedVariables().each(function (cvar) {
                                cvar.setDownstreamReadonly(true);
                            });
                        }
                        ConstrainedVariable.isSuggestingValue = true;
                        wasReadonly = eVar.isReadonly();
                        eVar.setReadonly(false);
                        eVar.suggestValue(value);
                        value = this.externalValue;
                    } finally {
                        eVar.setReadonly(wasReadonly);
                        ConstrainedVariable.isSuggestingValue = false;
                    }
                }
                if (value !== this.storedValue && !this.$$isStoring) {
                    this.$$isStoring = true;
                    try {
                        if (this.isSolveable()) {
                            var getterSetterPair = this.findOptionalSetter();
                            if (getterSetterPair) {
                                ConstrainedVariable.$$optionalSetters.push(getterSetterPair);
                            }
                        }
                        this.setValue(value);
                        this.updateDownstreamVariables(value);
                        this.updateConnectedVariables();
                    } catch (e) {
                        if (source) {
                            this.$$isStoring = false;
                            value = this.suggestValue(priorValue, source);
                            throw new Error(e); // XXX: Lively checks type, so wrap for top-level
                        } else {
                            throw e;
                        }
                    } finally {
                        this.$$isStoring = false;
                    }
                }
                if (callSetters) {
                    ConstrainedVariable.$$callingSetters = true;
                    var recvs = [],
                        setters = [];
                    ConstrainedVariable.$$optionalSetters.each(function (ea) {
                        var recvIdx = recvs.indexOf(ea.recv);
                        if (recvIdx === -1) {
                            recvIdx = recvs.length;
                            recvs.push(ea.recv);
                        }
                        setters[recvIdx] = setters[recvIdx] || [];
                        // If we have already called this setter for this recv, skip
                        if (setters[recvIdx].indexOf(ea.setter) !== -1) return;
                        setters[recvIdx].push(ea.setter);
                        try {
                            ea.recv[ea.setter](ea.recv[ea.getter]());
                        } catch(e) {
                            alert(e);
                        };
                    });
                    ConstrainedVariable.$$callingSetters = false;
                }
            } finally {
                if (callSetters) {
                    ConstrainedVariable.$$optionalSetters = null;
                }
                if (solver && source) {
                    solver.weight -= 987654321; // XXX Magic Number
                    this.findTransitiveConnectedVariables().each(function (cvar) {
                        cvar.setDownstreamReadonly(false);
                    });
                }
            }
        }
        return value;
    },

    findOptionalSetter: function() {
        if (this.setter) {
            return {recv: this.recv, getter: this.getter, setter: this.setter};
        } else {
            if (this.parentConstrainedVariable) {
                return this.parentConstrainedVariable.findOptionalSetter()
            }
        }
    },

    get getter() {
        return this.$getter;
    },
    get recv() {
        return this.$recv;
    },
    set getter(value) {
        this.$getter = value;
        if (this.recv) {
            var setter = value.replace("get", "set");
            if (Object.isFunction(this.recv[setter])) {
                this.setter = setter;
            }
        }
    },
    set recv(value) {
        this.$recv = value;
        if (this.getter) {
            var setter = this.getter.replace("get", "set");
            if (Object.isFunction(value[setter])) {
                this.setter = setter;
            }
        }
    },
    setDownstreamReadonly: function(bool) {
        if (bool && !this.$$downstreamReadonlyVars) {
            // flushCaches
            this.cachedDefiningSolver = null;
            this.cachedDefiningVar = null;
            var defVar = this.definingExternalVariable;
            this.$$downstreamReadonlyVars = [];
            this.eachExternalVariableDo(function (eVar) {
                if (eVar !== defVar) {
                    if (!eVar.isReadonly()) {
                        eVar.setReadonly(true);
                        this.$$downstreamReadonlyVars.push(eVar);
                    }
                }
            }.bind(this));
        } else if (!bool && this.$$downstreamReadonlyVars) {
            this.$$downstreamReadonlyVars.each(function (eVar) {
                eVar.setReadonly(false);
            }.bind(this));
            this.$$downstreamReadonlyVars = null;
        }
    },
    findTransitiveConnectedVariables: function(ary) {
        // XXX soooo slowwww
        var self = this;
        if (!ary) ary = [];
        if (ary.indexOf(this) !== -1) return;
        
        ary.push(this);
        this._constraints.each(function (c) {
            return c.constraintvariables.each(function (cvar) {
                cvar.findTransitiveConnectedVariables(ary);
            });
        });
        return ary;
    },
    updateConnectedVariables: function() {
        // so slow :(
        var self = this;
        this._constraints.collect(function (c) {
            return c.constraintvariables;
        }).flatten().uniq().each(function (cvar) {
            cvar.suggestValue(cvar.getValue()) // will store and recurse only if needed
        });
    },

    updateDownstreamVariables: function(value) {
        var defVar = this.definingExternalVariable;
        this.eachExternalVariableDo(function (ea) {
            if (ea !== defVar) {
                ea.setReadonly(false);
                ea.suggestValue(value);
                ea.setReadonly(true);
            }
        });

        this.setValue(value);
        // recalc
        this._constraints.each(function (c) {
            var eVar = this.externalVariables(c.solver);
            if (!eVar) {
                c.recalculate();
            }
        }.bind(this));
    },


    addToConstraint: function(constraint) {
        if (!this._constraints.include(constraint)) {
            this._constraints.push(constraint);
        }
        constraint.addConstraintVariable(this);
    },
    get definingSolver() {
        // if (!this.cachedDefiningSolver) {
            var solver = {weight: -1000};
            this.eachExternalVariableDo(function (eVar) {
                if (eVar) {
                    var s = eVar.__solver__;
                    if (s.weight > solver.weight) {
                        solver = s;
                    }
                }
            });
            // this.cachedDefiningSolver = solver;
            return solver
        // }
        // return this.cachedDefiningSolver;
    },
    get solvers() {
        var solvers = [];
        this.eachExternalVariableDo(function (eVar) {
            if (eVar) {
                var s = eVar.__solver__;
                solvers.push(s)
            }
        });
        return solvers;
    },
    get definingExternalVariable() {
        // if (!this.cachedDefiningVar) { 
        //     this.cachedDefiningVar = this.externalVariables(this.definingSolver);
        // }
        // return this.cachedDefiningVar;
        return this.externalVariables(this.definingSolver);
    },





    isSolveable: function() {
        return !!this.externalVariable;
    },

    get storedValue() {
        return this.obj[this.newIvarname];
    },
    get externalValue() {
        var value;
        if (typeof(this.externalVariable.value) == "function") {
            value = this.externalVariable.value();
        } else {
            value = this.externalVariable.value;
        }
        return value;
    },


    setValue: function(value) {
        this.obj[this.newIvarname] = value;
    },
    eachExternalVariableDo: function(func) {
        func.bind(this);
        for (key in this._externalVariables) {
            var eVar = this._externalVariables[key];
            if (eVar) { func(eVar, key); }
        }
    },

    getValue: function() {
        if (this.isSolveable()) {
            return this.externalValue;
        } else {
            return this.storedValue;
        }
    },


    get externalVariable() {
        if (this.currentSolver) {
            return this.externalVariables(this.currentSolver);
        } else {
            return this.definingExternalVariable;
        }
    },
    externalVariables: function(solver, value) {
        if (!solver.__uuid__) {
            solver.__uuid__ = Strings.newUUID()
        }
        if (arguments.length === 1) {
            return this._externalVariables[solver.__uuid__];
        } else {
            if (value) {
                value.__solver__ = value.__solver__ || solver;
                if (value.__cvar__ && !(value.__cvar__ === this)) {
                    throw "Inconsistent external variable. This should not happen!";
                }
                value.__cvar__ = this;
            }
            this._externalVariables[solver.__uuid__] = value || null;
        }
    }
})

users.timfelgentreff.jsinterpreter.InterpreterVisitor.subclass('ConstraintInterpreterVisitor', {

    binaryExpressionMap: {
        // operation: [method, reverseMethod (or undefined)]
        "+": ["plus", "plus"],
        "-": ["minus"],
        "*": ["times", "times"],
        "/": ["divide"],
        "==": ["cnEquals", "cnEquals"],
        "===": ["cnIdentical", "cnIdentical"],
        "<=": ["cnLeq", "cnGeq"],
        ">=": ["cnGeq", "cnLeq"],
        "<": ["cnLess", "cnGreater"],
        ">": ["cnGreater", "cnLess"],
        "||": ["cnOr", "cnOr"]
    },
    
    alternativeExpressionsMapTo: {
        "+": "-",
        "<=": "<",
        ">=": ">",
        "==": "==="
    },
    
    get alternativeExpressionsMap() {
        var map = {};
        Properties.own(this.alternativeExpressionsMapTo).each(function (ea) {
            map[this.alternativeExpressionsMapTo[ea]] = ea;
            map[ea] = this.alternativeExpressionsMapTo[ea];
        }.bind(this));
        return map;
    },



    getConstraintObjectValue: function(o) {
        if (o === undefined || !o.isConstraintObject) return o;
        var value = o.value;
        if (typeof(value) == "function") {
            return value.apply(o);
        } else {
            return value;
        }
    },
    errorIfUnsolvable: function(op, l, r, res) {
        if (typeof(res) == "undefined") {
            res = r;
            r = undefined;
        }
        
        if (!(l.isConstraintObject || (r && r.isConstraintObject)) ||
                Constraint.current.allowUnsolvableOperations) {
            return ((typeof(res) == "function") ? res() : res);
        } else {
            var msg = "`" + op + "'" + " not allowed on " + l,
                alternative;
            if (r !== undefined) {
                msg = "Binary op " + msg + " and " + r;
                
                var altOp = this.alternativeExpressionsMap[op];
                if (altOp) {
                    if (l[this.binaryExpressionMap[altOp][0]] || r[this.binaryExpressionMap[altOp][1]]) {
                        alternative = altOp;
                    }
                }
            }
            if (!alternative && Constraint.current.solver.alternativeOperationFor) {
                alternative = Constraint.current.solver.alternativeOperationFor(op);
            }
            
            msg += ". If you want to allow this, pass `allowUnsolvableOperations' to the constraint.";
            if (alternative) {
                msg += " You can also rewrite the code to use " + alternative + " instead.";
            }
            throw new Error(msg);
        }
    },

    visitVariable: function($super, node) {
        return $super(node);
    },

    visitCond: function($super, node) {
        var frame = this.currentFrame,
            condVal = this.visit(node.condExpr);
        if (condVal && condVal.isConstraintObject) {
            debugger
            var self = this;
            condVal = this.getConstraintObjectValue(condVal);
            if (!condVal) {
                condVal = cop.withoutLayers([ConstraintConstructionLayer], function() {
                    // XXX: this will cause GetSlot to call $super, so we don't get constrainded vars
                    return self.visit(node.condExpr);
                });
                debugger
            }
        }
        return condVal ? this.visit(node.trueExpr) : this.visit(node.falseExpr);
    },

    visitUnaryOp: function($super, node) {
        var frame = this.currentFrame,
            val = this.visit(node.expr),
            rVal = this.getConstraintObjectValue(val),
            msg = "Unary op `" + node.name + "'";
        
        switch (node.name) {
            case '-':
                if (val && val.isConstraintObject && val.times) {
                    return val.times(-1);
                } else {
                    return this.errorIfUnsolvable(msg, val, -rVal);
                }
            case '!':
                if (val && val.isConstraintObject && val.not) {
                    return val.not();
                } else {
                    return !val;
                    // return this.errorIfUnsolvable(msg, val, !val);
                }
            case '~':
                return this.errorIfUnsolvable(msg, val, ~rVal);;
            case 'typeof':
                return this.errorIfUnsolvable(msg, val, typeof(rVal));
            default:
              throw new Error('No semantics for unary op ' + node.name)
        }
    },

    invoke: function($super, node, recv, func, argValues) {
        if (!func && (!recv || !recv.isConstraintObject)) {
            var error = "No such method: " + recv + "." +  (node.property && node.property.value)
            alert(error);
            throw new Error(error);
        };
        if (recv && recv.isConstraintObject) {
            if (func) {
                var forInterpretation = func.forInterpretation;
                func.forInterpretation = undefined;
                try {
                    return cop.withoutLayers([ConstraintConstructionLayer], function() {
                        return $super(node, recv, func, argValues);
                    });
                } catch(e) {
                    // TIM: send doesNotUnderstand to solver variable?
                    return this.errorIfUnsolvable(
                        (node.property && node.property.value),
                        recv,
                        (function () {
                            var value = this.getConstraintObjectValue(recv);
                            var prop = this.visit(node.property);
                            return this.invoke(node, value, value[prop], argValues);
                        }).bind(this)
                    );
                } finally {
                    func.forInterpretation = forInterpretation;
                }
            } else {
                return this.errorIfUnsolvable(
                    (node.property && node.property.value),
                    recv,
                    (function () {
                        var value = this.getConstraintObjectValue(recv);
                        var prop = this.visit(node.property);
                        return this.invoke(node, value, value[prop], argValues);
                    }).bind(this)
                );
            }
        } else if (recv === Math) {
            if (func === Math.sqrt && argValues[0].pow || argValues[0].sqrt) {
                if (argValues[0].pow) {
                    return this.invoke(node, argValues[0], argValues[0].pow, [0.5]);
                } else {
                    return this.invoke(node, argValues[0], argValues[0].sqrt, []);
                }
            } else if (func === Math.pow && argValues[0].pow) {
                return this.invoke(node, argValues[0], argValues[0].pow, [argValues[1]]);
            } else if (func === Math.sin && argValues[0].sin) {
                return this.invoke(node, argValues[0], argValues[0].sin, []);
            } else if (func === Math.cos && argValues[0].cos) {
                return this.invoke(node, argValues[0], argValues[0].cos, []);
            } else {
                return $super(node, recv, func, argValues);
            }
        } else {
            return cop.withLayers([ConstraintConstructionLayer], function() {
                return $super(node, recv, func, argValues);
            });
        }
    },
    visitBinaryOp: function($super, node) {
        var op = node.name;

        // /* Only supported */ if (node.name.match(/[\*\+\/\-]|==|<=|>=|===|<|>|\|\|/)) {
        var leftVal = this.visit(node.left),
            rightVal = this.visit(node.right);
        
        if (leftVal === undefined) leftVal = 0;
        if (rightVal === undefined) rightVal = 0;
        
        var rLeftVal = leftVal.isConstraintObject ? this.getConstraintObjectValue(leftVal) : leftVal,
            rRightVal = rightVal.isConstraintObject ? this.getConstraintObjectValue(rightVal) : rightVal;                    
        switch (node.name) {
            case '&&':
                if (!leftVal) return leftVal;
                if (leftVal === true || leftVal.isConstraintObject) {
                    if (typeof(leftVal.cnAnd) == "function") {
                        return leftVal.cnAnd(rightVal);
                    } else {
                        Constraint.current.addPrimitiveConstraint(leftVal);
                    }
                } else {
                    Constraint.current.haltIfDebugging(); // XXX: Sure?
                }
                return rightVal;
            case '-':
                if (rightVal.isConstraintObject && rightVal.plus && Object.isNumber(leftVal)) {
                    return rightVal.plus(-leftVal);
                } // special case for reversing minus - allowed to fall through to default
            case 'in':
                if (node.name != '-') {
                	if (leftVal.isConstraintObject && leftVal.cnIn) {
                        return leftVal.cnIn(rightVal);
                    } // special case for reversing minus - allowed to fall through to default
                	// TODO: rightVal->contains if !leftVal.isConstraintObject
                }
            default:
                var method = this.binaryExpressionMap[node.name];
                if (method) {
                    if (leftVal.isConstraintObject && typeof(leftVal[method[0]]) == "function") {
                        return leftVal[method[0]](rightVal);
                    } else if (rightVal.isConstraintObject && typeof(rightVal[method[1]]) == "function") {
                        return rightVal[method[1]](leftVal);
                    } else {
                        return this.errorIfUnsolvable(op, leftVal, rightVal, eval("rLeftVal " + node.name + " rRightVal"));
                    }
                } else {
                    return this.errorIfUnsolvable(op, leftVal, rightVal, $super(node));
                }
        }
    },


    visitGetSlot: function($super, node) {
        if (cop.currentLayers().indexOf(ConstraintConstructionLayer) === -1) {
            // XXX: See visitCond
            return $super(node);
        }
        var obj = this.visit(node.obj),
            name = this.visit(node.slotName),
            cobj = (obj ? obj[ConstrainedVariable.ThisAttrName] : undefined),
            cvar;
        if (obj === Global || (obj instanceof lively.Module) /*|| (typeof(obj) == "string")*/) {
            return obj[name];
        }
        if (obj && obj.isConstraintObject) {
            if (obj["cn" + name]) {
                return obj["cn" + name]; // XXX: TODO: Document this
            } else {
                cobj = obj.__cvar__;
                obj = this.getConstraintObjectValue(obj);
            }
        }

        cvar = ConstrainedVariable.newConstraintVariableFor(obj, name, cobj);
        if (Constraint.current) {
            cvar.ensureExternalVariableFor(Constraint.current.solver);
            cvar.addToConstraint(Constraint.current);
        }
        if (cvar && cvar.isSolveable()) {
            return cvar.externalVariable;
        } else {
            var retval = obj[name]
            if (!retval || !retval.isConstraintObject) {
                var toS = Object.prototype.toString, objStr, retStr;
                try { objStr = obj.toString() } catch(e) { objStr = toS.apply(obj) };
                try { retStr = retval.toString() } catch(e) { retStr = toS.apply(retval) };
                console.log(Constraint.current.solver.constructor.name +
                    " cannot reason about the variable " + objStr + "[" + name +"], a " + retStr +
                    " of type " + (typeof(retval) == "object" ? retval.constructor.name : typeof(retval)));
                Constraint.current.haltIfDebugging();
            }
            if (retval) {
            	switch (typeof(retval)) {
            	case "object": retval[ConstrainedVariable.ThisAttrName] = cvar; break;
            	case "number": new Number(retval)[ConstrainedVariable.ThisAttrName] = cvar; break;
            	case "string": new String(retval)[ConstrainedVariable.ThisAttrName] = cvar; break;
            	default: throw "Error - we cannot store the constrained var attribute on " + retval + " of type " + typeof(retval);
            	}
                
            }
            return retval;
        }
    },
    visitReturn: function($super, node) {
        var retVal = $super(node);
        if (retVal) {
            var cvar = retVal[ConstrainedVariable.ThisAttrName];
            if (retVal.isConstraintObject) {
                cvar = retVal.__cvar__;
            }
            if (cvar) {
                var parentFunc = node.parentFunction();
                if (parentFunc) {
                    cvar.getter = parentFunc.name();
                    cvar.recv = this.currentFrame.mapping["this"];
                }
            }
        }
        return retVal;
    },



    shouldInterpret: function(frame, func) {
        if (func.sourceModule === Global.users.timfelgentreff.babelsberg.constraintinterpreter) {
            return false;
        }
        if (func.declaredClass === "Babelsberg") {
            return false
        }
        var nativeClass = lively.Class.isClass(func) && func.superclass === undefined;
        return (!(this.isNative(func) || nativeClass)) &&
                 typeof(func.forInterpretation) == "function"
    },
    newObject: function($super, func) {
        if (func.original) {
            return $super(func.original);
        } else {
            return $super(func);
        }
    },

})

ConstrainedVariable.AttrName = "__constrainedVariables__";
ConstrainedVariable.ThisAttrName = "__lastConstrainedVariableForThis__";
Object.extend(ConstrainedVariable, {
    findConstraintVariableFor: function(obj, ivarname) {
        var l = obj[ConstrainedVariable.AttrName ];
        if (l && l[ivarname]) {
            return l[ivarname];
        } else {
            return null;
        }
    },

    newConstraintVariableFor: function(obj, ivarname, cobj) {
        var cvar = this.findConstraintVariableFor(obj, ivarname);
        if (!cvar) {
            cvar = new ConstrainedVariable(obj, ivarname, cobj);
            obj[ConstrainedVariable.AttrName] = obj[ConstrainedVariable.AttrName] || {};
            obj[ConstrainedVariable.AttrName][ivarname] = cvar;
        }
        return cvar;
    },
    
    deleteConstraintVariableFor: function(obj, ivarname) {
        var l = obj[ConstrainedVariable.AttrName ];
        if (l && l[ivarname]) {
            delete l[ivarname];
        }
    },

    isSuggestingValue: false,
});

Object.subclass("PrimitiveCObjectRegistry", {});
Object.extend(PrimitiveCObjectRegistry, {
	registry: {},

	// stores last seen cvars for objects weakly
	set: function (obj, cobj) {
		PrimitiveCObjectRegistry.registry[obj] = cobj;
	},
	get: function (obj) {
		return PrimitiveCObjectRegistry.registry[obj];
	}
});

Number.prototype.__defineGetter__(ConstrainedVariable.ThisAttrName, function () {
	return PrimitiveCObjectRegistry.get(this + 0 /* coerce back into prim */);
});
Number.prototype.__defineGetter__(ConstrainedVariable.AttrName, function () {
	return {};
});
Number.prototype.__defineSetter__(ConstrainedVariable.ThisAttrName, function (v) {
	PrimitiveCObjectRegistry.set(this + 0 /* coerce back into prim */, v);
});
String.prototype.__defineGetter__(ConstrainedVariable.ThisAttrName, function () {
	return PrimitiveCObjectRegistry.get(this + "" /* coerce back into prim */);
});
String.prototype.__defineGetter__(ConstrainedVariable.AttrName, function () {
	return {};
});
String.prototype.__defineSetter__(ConstrainedVariable.ThisAttrName, function (v) {
	PrimitiveCObjectRegistry.set(this + "" /* coerce back into prim */, v);
});


})
 