function camera_OrthoProjection(pos, width, height)
{
  var L = pos[0] - width / 2;
	var R = pos[0] + width / 2;
	var T = pos[1] + height / 2;
	var B = pos[1] - height / 2;
	var res = 
	[
		2.0/(R-L),   0.0,           0.0,       0.0,
		0.0,         2.0/(T-B),     0.0,       0.0,
		0.0,         0.0,           0.5,       0.0,
		(R+L)/(L-R),  (T+B)/(B-T),    0.5,       1.0,
  ];
	
	return res;
}

async function loadImages(gl, paths, width, height)
{
  const images = [];
  for(let i = 0; i < paths.length; i += 1)
  {
    images.push(await loadImage(paths[i]));
  }

  var particle_tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, particle_tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, images.length - 1, gl.RGBA8, width, height, images.length);
  for(let i = 0; i < images.length; i += 1)
  {
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, width, height, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, images[i]);
  }
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return particle_tex;
}

function loadImage(url) {
  return new Promise(resolve => {
    const image = new Image();
    image.addEventListener('load', () => {
      resolve(image);
    });
    image.src = url;
  });
}

function createShader(gl, shader_info) {
  var shader = gl.createShader(shader_info.type);
  var i = 0;
  var shader_source = document.getElementById(shader_info.name).text;
  /* skip whitespace to avoid glsl compiler complaining about
  #version not being on the first line*/
  while (/\s/.test(shader_source[i])) i++;
  shader_source = shader_source.slice(i);
  gl.shaderSource(shader, shader_source);
  gl.compileShader(shader);
  var compile_status = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!compile_status) {
    var error_message = gl.getShaderInfoLog(shader);
    throw "Could not compile shader \"" +
          shader_info.name +
          "\" \n" +
          error_message;
  }
  return shader;
}

/* Creates an OpenGL program object.
   `gl' shall be a WebGL 2 context.
   `shader_list' shall be a list of objects, each of which have a `name'
      and `type' properties. `name' will be used to locate the script tag
      from which to load the shader. `type' shall indicate shader type (i. e.
      gl.FRAGMENT_SHADER, gl.VERTEX_SHADER, etc.)
  `transform_feedback_varyings' shall be a list of varying that need to be
    captured into a transform feedback buffer.*/
function createGLProgram(gl, shader_list, transform_feedback_varyings) {
  var program = gl.createProgram();
  for (var i = 0; i < shader_list.length; i++) {
    var shader_info = shader_list[i];
    var shader = createShader(gl, shader_info);
    gl.attachShader(program, shader);
  }

  /* Specify varyings that we want to be captured in the transform
     feedback buffer. */
  if (transform_feedback_varyings != null) {
    gl.transformFeedbackVaryings(program,
                                 transform_feedback_varyings,
                                 gl.INTERLEAVED_ATTRIBS);
  }
  gl.linkProgram(program);
  var link_status = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!link_status) {
    var error_message = gl.getProgramInfoLog(program);
    throw "Could not link program.\n" + error_message;
  }
  return program;
}

function randomRGData(size_x, size_y) {
  var d = [];
  for (var i = 0; i < size_x * size_y; ++i) {
    d.push(Math.random() * 255.0);
    d.push(Math.random() * 255.0);
  }
  return new Uint8Array(d);
}

function initialParticleData(num_parts, min_age, max_age) {
  var data = [];
  for (var i = 0; i < num_parts; ++i) {
    data.push(0.0);
    data.push(0.0);
    var life = min_age + Math.random() * (max_age - min_age);
    data.push(life + 1);
    data.push(life);
    data.push(0.0);
    data.push(0.0);
  }
  return data;
}

function setupParticleBufferVAO(gl, buffers, vao) {
  gl.bindVertexArray(vao);
  for (var i = 0; i < buffers.length; i++) {
    var buffer = buffers[i];
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer_object);
    var offset = 0;
    for (var attrib_name in buffer.attribs) {
      if (buffer.attribs.hasOwnProperty(attrib_name)) {
        var attrib_desc = buffer.attribs[attrib_name];
        gl.enableVertexAttribArray(attrib_desc.location);
        gl.vertexAttribPointer(
          attrib_desc.location,
          attrib_desc.num_components,
          attrib_desc.type,
          false, 
          buffer.stride,
          offset);
        var type_size = 4; /* we're only dealing with types of 4 byte size in this demo, unhardcode if necessary */
        offset += attrib_desc.num_components * type_size; 
        if (attrib_desc.hasOwnProperty("divisor")) {
          gl.vertexAttribDivisor(attrib_desc.location, attrib_desc.divisor);
        }
      }
    }
  }
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

function init(
    gl,
    num_particles,
    particle_birth_rate,
    min_age,
    max_age, 
    min_theta,
    max_theta,
    min_speed,
    max_speed,
    gravity) { // Note the new parameter.
  if (max_age < min_age) {
    throw "Invalid min-max age range.";
  }
  if (max_theta < min_theta ||
      min_theta < -Math.PI ||
      max_theta > Math.PI) {
    throw "Invalid theta range.";
  }
  if (min_speed > max_speed) {
    throw "Invalid min-max speed range.";
  }
  var update_program = createGLProgram(
    gl,
    [
      {name: "particle-update-vert", type: gl.VERTEX_SHADER},
      {name: "passthru-frag-shader", type: gl.FRAGMENT_SHADER},
    ],
    [
      "v_Position",
      "v_Age",
      "v_Life",
      "v_Velocity",
    ]);
  var render_program = createGLProgram(
    gl,
    [
      {name: "particle-render-vert", type: gl.VERTEX_SHADER},
      {name: "particle-render-frag", type: gl.FRAGMENT_SHADER},
    ],
    null);
  var update_attrib_locations = {
    i_Position: {
      location: gl.getAttribLocation(update_program, "i_Position"),
      num_components: 2,
      type: gl.FLOAT
    },
    i_Age: {
      location: gl.getAttribLocation(update_program, "i_Age"),
      num_components: 1,
      type: gl.FLOAT
    },
    i_Life: {
      location: gl.getAttribLocation(update_program, "i_Life"),
      num_components: 1,
      type: gl.FLOAT
    },
    i_Velocity: {
      location: gl.getAttribLocation(update_program, "i_Velocity"),
      num_components: 2,
      type: gl.FLOAT
    }
  };
  var render_attrib_locations = {
    i_Position: {
      location: gl.getAttribLocation(render_program, "i_Position"),
      num_components: 2,
      type: gl.FLOAT,
      divisor: 1
    },
    i_Age: {
      location: gl.getAttribLocation(render_program, "i_Age"),
      num_components: 1,
      type: gl.FLOAT,
      divisor: 1
    },
    i_Life: {
      location: gl.getAttribLocation(render_program, "i_Life"),
      num_components: 1,
      type: gl.FLOAT,
      divisor: 1
    }
  };
  var vaos = [
    gl.createVertexArray(),
    gl.createVertexArray(),
    gl.createVertexArray(),
    gl.createVertexArray()
  ];
  var buffers = [
    gl.createBuffer(),
    gl.createBuffer(),
  ];
  var sprite_vert_data =
    new Float32Array([
      1, 1,
      1, 1,

      -1, 1,
      0, 1,
      
      -1, -1,
      0, 0,
      
      1, 1,
      1, 1,
      
      -1, -1,
      0, 0,
      
      1, -1,
      1, 0]);
  var sprite_attrib_locations = {
    i_Coord: {
      location: gl.getAttribLocation(render_program, "i_Coord"),
      num_components: 2,
      type: gl.FLOAT,
    },
    i_TexCoord: {
      location: gl.getAttribLocation(render_program, "i_TexCoord"),
      num_components: 2,
      type: gl.FLOAT
    }
  };
  var sprite_vert_buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, sprite_vert_buf);
  gl.bufferData(gl.ARRAY_BUFFER, sprite_vert_data, gl.STATIC_DRAW);
  var vao_desc = [
    {
      vao: vaos[0],
      buffers: [{
        buffer_object: buffers[0],
        stride: 4 * 6,
        attribs: update_attrib_locations
      }]
    },
    {
      vao: vaos[1],
      buffers: [{
        buffer_object: buffers[1],
        stride: 4 * 6,
        attribs: update_attrib_locations
      }]
    },
    {
      vao: vaos[2],
      buffers: [{
        buffer_object: buffers[0],
        stride: 4 * 6,
        attribs: render_attrib_locations
      },
      {
        buffer_object: sprite_vert_buf,
        stride: 4 * 4,
        attribs: sprite_attrib_locations
      }],
    },
    {
      vao: vaos[3],
      buffers: [{
        buffer_object: buffers[1],
        stride: 4 * 6,
        attribs: render_attrib_locations
      },
      {
        buffer_object: sprite_vert_buf,
        stride: 4 * 4,
        attribs: sprite_attrib_locations
      }],
    },
  ];
  var initial_data =
    new Float32Array(initialParticleData(num_particles, min_age, max_age));
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers[0]);
  gl.bufferData(gl.ARRAY_BUFFER, initial_data, gl.STREAM_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers[1]);
  gl.bufferData(gl.ARRAY_BUFFER, initial_data, gl.STREAM_DRAW);
  for (var i = 0; i < vao_desc.length; i++) {
    setupParticleBufferVAO(gl, vao_desc[i].buffers, vao_desc[i].vao);
  }

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  var rg_noise_texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, rg_noise_texture);
  gl.texImage2D(gl.TEXTURE_2D,
                0, 
                gl.RG8,
                512, 512,
                0,
                gl.RG,
                gl.UNSIGNED_BYTE,
                randomRGData(512, 512));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  // var particle_tex = gl.createTexture();
  // gl.bindTexture(gl.TEXTURE_2D, particle_tex);
  // // gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 32, 32, 0, gl.RGBA, gl.UNSIGNED_BYTE, part_img);
  // gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, part_img);
  // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return {
    particle_sys_buffers: buffers,
    particle_sys_vaos: vaos,
    read: 0,
    write: 1,
    particle_update_program: update_program,
    particle_render_program: render_program,
    num_particles: initial_data.length / 6,
    old_timestamp: 0.0,
    rg_noise: rg_noise_texture,
    total_time: 0.0,
    born_particles: 0,
    birth_rate: particle_birth_rate,
    gravity: gravity,
    origin: [0.0, 0.0],
    min_theta: min_theta,
    max_theta: max_theta,
    min_speed: min_speed,
    max_speed: max_speed,
  };
}

function render(gl, state, timestamp_millis) {
  state.origin[0] = 400.0 * Math.cos(200 * timestamp_millis * 1000.0);
  state.origin[1] = 300;
  var num_part = state.born_particles;
  var time_delta = 0.0;
  if (state.old_timestamp != 0) {
    time_delta = timestamp_millis - state.old_timestamp;
    if (time_delta > 500.0) {
      time_delta = 0.0;
    }
  }
  if (state.born_particles < state.num_particles) {
    state.born_particles = Math.min(state.num_particles,
                    Math.floor(state.born_particles + state.birth_rate * time_delta));
  }
  state.old_timestamp = timestamp_millis;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(state.particle_update_program);
  gl.uniform1f(
    gl.getUniformLocation(state.particle_update_program, "u_TimeDelta"),
    time_delta / 1000.0);
  gl.uniform1f(
    gl.getUniformLocation(state.particle_update_program, "u_TotalTime"),
    state.total_time);
  gl.uniform2f(
    gl.getUniformLocation(state.particle_update_program, "u_Gravity"),
    state.gravity[0], state.gravity[1]);
  gl.uniform2f(
    gl.getUniformLocation(state.particle_update_program, "u_Origin"),
    state.origin[0],
    state.origin[1]);
  gl.uniform1f(
    gl.getUniformLocation(state.particle_update_program, "u_MinTheta"),
    state.min_theta);
  gl.uniform1f(
    gl.getUniformLocation(state.particle_update_program, "u_MaxTheta"),
    state.max_theta);
  gl.uniform1f(
    gl.getUniformLocation(state.particle_update_program, "u_MinSpeed"),
    state.min_speed);
  gl.uniform1f(
    gl.getUniformLocation(state.particle_update_program, "u_MaxSpeed"),
    state.max_speed);
  state.total_time += time_delta;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.rg_noise);
  gl.uniform1i(
    gl.getUniformLocation(state.particle_update_program, "u_RgNoise"),
    0);
  gl.bindVertexArray(state.particle_sys_vaos[state.read]);
  gl.bindBufferBase(
    gl.TRANSFORM_FEEDBACK_BUFFER, 0, state.particle_sys_buffers[state.write]);
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, num_part);
  gl.endTransformFeedback();
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
  gl.bindVertexArray(state.particle_sys_vaos[state.read + 2]);
  gl.useProgram(state.particle_render_program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, state.particle_tex);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(state.particle_render_program, "u_wvp"),
    false, camera_OrthoProjection([0, 0], 800, 600));
  gl.uniform1f(
    gl.getUniformLocation(state.particle_render_program, "u_size"),
    state.size);
  gl.uniform1i(
    gl.getUniformLocation(state.particle_render_program, "u_Sprite"),
    0);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, num_part);
  var tmp = state.read;
  state.read = state.write;
  state.write = tmp;
  window.requestAnimationFrame(function(ts) { render(gl, state, ts); });
}

function main() {
  var canvas_element = document.createElement("canvas");
  canvas_element.width = 800;
  canvas_element.height = 600;
  var webgl_context = canvas_element.getContext("webgl2");
  if (webgl_context != null) {
    document.body.appendChild(canvas_element);
    
    loadImages(webgl_context,
      [
        "./sakura0.png",
        "./sakura1.png",
        "./sakura2.png",
        "./sakura3.png",
        // "./sakura4.png",
      ],
      24, 24).then((part_img) => {
      var state =
        init(
          webgl_context,
          200,
          0.90,
          0.8, 1.9,
          -Math.PI, Math.PI,
          0.0, 10.5,
          [0.0, -500.0]);
      // canvas_element.onmousemove = function(e) {
      //   var x = (e.pageX - this.offsetLeft) - this.width / 2; 
      //   var y = -(e.pageY - this.offsetTop) + this.height / 2;
      //   state.origin = [x, y];
      // };
      // state.origin = [200.0 * Math.cos(4.0 * ts), 200.0];
      state.size = 35.0;
      state.particle_tex = part_img;
      window.requestAnimationFrame(
        function(ts) { render(webgl_context, state, ts); });
    });
  } else {
    document.write("WebGL2 is not supported by your browser");
  }
}
