function updateState(state, action) {
  return { ...state, ...action };
}

function historyUpdateState(state, action) {
  if (action.undo) {
    if (state.done.length === 0) {
      return state;
    }

    return {
      ...state,
      picture: state.done[0],
      done: state.done.slice(1),
      doneAt: 0,
    };
  }

  if (action.picture != null && state.doneAt < Date.now() - 1000) {
    return {
      ...state,
      ...action,
      done: [state.picture, ...state.done],
      doneAt: Date.now(),
    };
  }

  return {
    ...state,
    ...action,
  };
}

function elt(type, props, ...children) {
  const dom = document.createElement(type);
  if (props != null) {
    Object.assign(dom, props);
  }

  for (const child of children) {
    if (typeof child !== "string") {
      dom.appendChild(child);
      continue;
    }

    dom.appendChild(document.createTextNode(child));
  }

  return dom;
}

function pictureFromImage(img) {
  const width = Math.min(100, img.width);
  const height = Math.min(100, img.height);
  const canvas = elt("canvas", { width, height });
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const pixels = [];
  const { data } = ctx.getImageData(0, 0, width, height);

  function hex(n) {
    return n.toString(16).padStart(2, "0");
  }

  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = data.slice(i, i + 3);
    pixels.push("#" + hex(r) + hex(g) + hex(b));
  }

  return new Picture(width, height, pixels);
}

function finishLoad(file, dispatch) {
  if (file == null) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const img = elt("img", {
      onload: () => dispatch({ picture: pictureFromImage(img) }),
      src: reader.result,
    });
  });

  reader.readAsDataURL(file);
}

function startLoad(dispatch) {
  const input = elt("input", {
    type: "file",
    onchange: () => finishLoad(input.files[0], dispatch),
  });
  document.body.appendChild(input);
  input.click();
  input.remove();
}

function drawPicture(picture, canvas, scale) {
  canvas.width = picture.width * scale;
  canvas.height = picture.height * scale;

  const ctx = canvas.getContext("2d");
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) {
      ctx.fillStyle = picture.pixel(x, y);
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

function pointerPosition(pos, domNode) {
  const rect = domNode.getBoundingClientRect();
  return {
    x: Math.floor((pos.clientX - rect.left) / scale),
    y: Math.floor((pos.clientY - rect.top) / scale),
  };
}

function draw(pos, state, dispatch) {
  function drawPixel({ x, y }, pixelState) {
    const drawn = { x, y, color: pixelState.color };
    dispatch({ picture: state.picture.draw([drawn]) });
  }

  drawPixel(pos, state);
  return drawPixel;
}

function rectangle(start, state, dispatch) {
  function drawRectangle(pos) {
    const xStart = Math.min(start.x, pos.x);
    const yStart = Math.min(start.y, pos.y);

    const xEnd = Math.max(start.x, pos.x);
    const yEnd = Math.max(start.y, pos.y);

    const drawn = [];
    for (let y = yStart; y <= yEnd; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        drawn.push({ x, y, color: state.color });
      }
    }
    dispatch({ picture: state.picture.draw(drawn) });
  }

  drawRectangle(start);
  return drawRectangle;
}

const around = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
];

function fill({ x, y }, state, dispatch) {
  const targetColor = state.picture.pixel(x, y);
  const drawn = [{ x, y, color: state.color }];
  for (let done = 0; done < drawn.length; done++) {
    for (const { dx, dy } of around) {
      const x = drawn[done].x + dx;
      const y = drawn[done].y + dy;
      if (
        x >= 0 &&
        x < state.picture.width &&
        y >= 0 &&
        y < state.picture.height &&
        state.picture.pixel(x, y) === targetColor &&
        !drawn.some((p) => p.x === x && p.y === y)
      ) {
        drawn.push({ x, y, color: state.color });
      }
    }
  }

  dispatch({ picture: state.picture.draw(drawn) });
}

function pick(pos, state, dispatch) {
  dispatch({ color: state.picture.pixel(pos.x, pos.y) });
}

class Picture {
  constructor(width, height, pixels) {
    this.width = width;
    this.height = height;
    this.pixels = pixels;
  }

  static empty(width, height, color) {
    const pixels = new Array(width * height).fill(color);
    return new Picture(width, height, pixels);
  }

  pixel(x, y) {
    return this.pixels[x + y * this.width];
  }

  draw(pixels) {
    const copy = this.pixels.slice();
    for (const { x, y, color } of pixels) {
      copy[x + y * this.width] = color;
    }

    return new Picture(this.width, this.height, copy);
  }
}

const scale = 10;

class PictureCanvas {
  constructor(picture, pointerDown) {
    this.dom = elt("canvas", {
      onmousedown: (e) => this.mouse(e, pointerDown),
      ontouchstart: (e) => this.touch(e, pointerDown),
    });
    this.syncState(picture);
  }

  touch(startEvent, onDown) {
    const pos = pointerPosition(startEvent.touches[0], this.dom);
    const onMove = onDown(pos);
    startEvent.preventDefault();
    if (onMove == null) {
      return;
    }

    const move = (e) => {
      const newPos = pointerPosition(e.touches[0], this.dom);
      if (newPos.x === pos.x && newPos.y === pos.y) {
        return;
      }

      onMove(newPos);
    };

    const end = () => {
      this.dom.removeEventListener("touchmove", move);
      this.dom.removeEventListener("touchend", end);
    };

    this.dom.addEventListener("touchmove", move);
    this.dom.addEventListener("touchend", end);
  }

  mouse(downEvent, onDown) {
    if (downEvent.button != 0) {
      return;
    }

    const pos = pointerPosition(downEvent, this.dom);
    const onMove = onDown(pos);
    if (onMove == null) {
      return;
    }

    const move = (e) => {
      if (e.buttons === 0) {
        this.dom.removeEventListener("mousemove", move);
        return;
      }

      const newPos = pointerPosition(e, this.dom);
      if (newPos.x === pos.x && newPos.y === pos.y) {
        return;
      }

      onMove(newPos);
    };

    this.dom.addEventListener("mousemove", move);
  }

  syncState(picture) {
    if (this.picture == picture) {
      return;
    }

    this.picture = picture;
    drawPicture(this.picture, this.dom, scale);
  }
}

class ToolSelect {
  constructor(state, { tools, dispatch }) {
    this.select = elt(
      "select",
      {
        onchange: () => dispatch({ tool: this.select.value }),
      },
      ...Object.keys(tools).map((toolName) =>
        elt("option", {
          selected: toolName === state.tool,
          innerText: toolName,
        })
      )
    );
    this.dom = elt("label", null, " Tool: ", this.select);
  }

  syncState(state) {
    this.select.value = state.tool;
  }
}

class ColorSelect {
  constructor(state, { dispatch }) {
    this.input = elt("input", {
      type: "color",
      value: state.color,
      onchange: () => dispatch({ color: this.input.value }),
    });
    this.dom = elt("label", null, "🎨 Color: ", this.input);
  }

  syncState(state) {
    this.input.value = state.color;
  }
}

class PixelEditor {
  constructor(state, config) {
    const { tools, controls, dispatch } = config;
    this.state = state;
    this.canvas = new PictureCanvas(state.picture, (pos) => {
      const tool = tools[this.state.tool];
      const onMove = tool(pos, this.state, dispatch);
      if (onMove != null) {
        return (pos) => onMove(pos, this.state);
      }
    });
    this.controls = controls.map((Control) => new Control(state, config));
    this.dom = elt(
      "div",
      {
        tabIndex: 0,
        onkeydown: (e) => this.keyDown(e, config),
      },
      this.canvas.dom,
      elt("br"),
      ...this.controls.reduce((a, c) => a.concat(" ", c.dom), [])
    );
  }

  keyDown(e, config) {
    if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      config.dispatch({ undo: true });
      return;
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      for (const tool of Object.keys(config.tools)) {
        if (tool[0] === e.key) {
          e.preventDefault();
          config.dispatch({ tool });
          return;
        }
      }
    }
  }

  syncState(state) {
    this.state = state;
    this.canvas.syncState(state.picture);
    for (const ctrl of this.controls) {
      ctrl.syncState(state);
    }
  }
}

class SaveButton {
  constructor(state) {
    this.picture = state.picture;
    this.dom = elt("button", { onclick: () => this.save() }, "💾 Save");
  }

  save() {
    const canvas = elt("canvas");
    drawPicture(this.picture, canvas, 1);
    const link = elt("a", {
      href: canvas.toDataURL(),
      download: "pixelart.png",
    });

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  syncState(state) {
    this.picture = state.picture;
  }
}

class LoadButton {
  constructor(_, { dispatch }) {
    this.dom = elt("button", { onclick: () => startLoad(dispatch) }, "📁 Load");
  }

  syncState() {}
}

class UndoButton {
  constructor(state, { dispatch }) {
    this.dom = elt(
      "button",
      {
        onclick: () => dispatch({ undo: true }),
        disabled: state.done.length === 0,
      },
      " Undo"
    );
  }

  syncState(state) {
    this.dom.disabled = state.done.length === 0;
  }
}

const startState = {
  tool: "draw",
  color: "#000000",
  picture: Picture.empty(60, 30, "#f0f0f0"),
  done: [],
  doneAt: 0,
};

const baseTools = { draw, fill, rectangle, pick };
const baseControls = [
  ToolSelect,
  ColorSelect,
  SaveButton,
  LoadButton,
  UndoButton,
];

function startPixelEditor(
  state = startState,
  tools = baseTools,
  controls = baseControls
) {
  const app = new PixelEditor(state, {
    tools,
    controls,
    dispatch(action) {
      state = historyUpdateState(state, action);
      app.syncState(state);
    },
  });

  return app.dom;
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelector("#container").appendChild(startPixelEditor());
});
