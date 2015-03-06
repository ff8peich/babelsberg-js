define([
    "./../input",
    "./../gui",
    "./../view/viewport",
    "./../world/worldbuilder",
    "./../rendering/renderer",
    "./../game/debuglayer"
], function Game(
    Input,
    Gui,
    Viewport,
    WorldBuilder,
    Renderer,
    DebugLayer
) {
    var Game = Object.subclass("Game", {
        initialize: function(canvasId) {
            //TODO: delegate to dedicated builder/factory functions
            this.buildCanvas(canvasId);
            this.buildInput(canvasId);
            this.renderer = new Renderer(this.canvas);
            this.buildViewport();
            this.constrainDebugLayer();
            this.levels = new LevelPointer();
        },
        buildCanvas: function(canvasId) {
            this.canvas = document.getElementById(canvasId);
            this.canvas.style.position = "absolute";
            this.canvas.style.top = "0px";
            this.canvas.style.left = "0px";
            this.canvas.style["z-index"] = -1;
        },
        buildInput: function(canvasId) {
            this.input = new Input(canvasId);

            _.each({
                W: "up",
                A: "left",
                S: "down",
                D: "right",

                UP_ARROW: "up",
                LEFT_ARROW: "left",
                DOWN_ARROW: "down",
                RIGHT_ARROW: "right",

                MOUSE1: "leftclick",
                MOUSE2: "rightclick",
                MWHEEL_UP: "zoomIn",
                MWHEEL_DOWN: "zoomOut",

                O: "debug",
                P: "pause"
            }, function(state, key){
                this.input.bind(Input.KEY[key], state);
            }, this);
        },
        buildViewport: function() {
            var input = this.input,
                // TODO: find correct domain, also adjust debug targeting tiles
                viewport = this.viewport = new Viewport(
                    new Vector2(19, 19 * this.canvas.height/this.canvas.width),
                    new Vector2(19*2, 19*2 * this.canvas.height/this.canvas.width)
                );

            // constraint:
            // - keep input position in world and mouse on screen in sync
            // old, fast version
            bbb.always({
                solver: new DBPlanner(),
                ctx: {
                    input: input,
                    viewport: viewport
                },
                methods: function() {
                    input.position.formula([input.mouse, input.mouse.x, input.mouse.y], function(mouse, mouseX, mouseY) {
                        return viewport.screenToWorldCoordinates(mouse);
                    });
                }
            }, function() {
                return input.position.equals(viewport.screenToWorldCoordinates(input.mouse));
            });

/*
            // new clean but slow version using automatic inference of formulas
            always: {
                solver: new DBPlanner()
                input.position.equals(viewport.screenToWorldCoordinates(input.mouse))
            }
*/
        },
        constrainDebugLayer: function() {
            var input = this.input;

            // constraint: debugdraw velocities if debug mode is switched on
            DebugLayer.activeOn({
                ctx: {
                    input: input
                }
            }, function() {
                return input.switchedOn("debug");
            });

            GameLayer.activeOn({
                ctx: {
                    input: input
                }
            }, function() {
                return input.switchedOff("pause");
            });
        },
        prepare: function() {
            this.resetLevel();
        },
        resetLevel: function() {
            this.createLevel(this.levels.get());
        },
        nextLevel: function() {
            this.createLevel(this.levels.next());
        },
        createLevel: function(level) {
            this.cleanUp();
            var builder = new WorldBuilder(this);
            this.world = builder.buildWorld(level);

            this.gui = new Gui(this.world, this.input, player, this.viewport);
        },
        cleanUp: function() {
            // TODO
        },
        update: function(dt) {
            this.updatePhysics(dt);
            this.gui.update(dt);
            this.draw();

            this.input.clearPressed();
        },
        updatePhysics: function(dt) {
            this.world.getGameObjects()
                .filter(function(gameObject) {
                    return gameObject.controls && gameObject.controls.getTargetTiles;
                })
                .each(function(gameObject) {
                    gameObject.controls.getTargetTiles();
                });
        },
        draw: function() {
            this.renderer.clear();
            this.renderer.withViewport(this.viewport, (function() {
                this.world.draw(this.renderer);
            }).bind(this));
            this.gui.draw(this.renderer);
        }
    });

    GameLayer = new Layer()
        .refineClass(Game, {
            updatePhysics: function(dt) {
                this.world.update(dt);
            }
        });

    return Game;
});