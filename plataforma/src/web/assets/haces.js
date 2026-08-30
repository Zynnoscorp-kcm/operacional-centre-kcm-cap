/*
 * Fondo de haces de la marca.
 *
 * Es el bloque de fondo del quiosco, movido a un archivo
 * propio porque ahora lo comparten dos pantallas: el quiosco de sala y la
 * puerta de la consola en `/acceso`. No se retocó ni una constante —velocidad,
 * ruido, escala, ancho y número de haces, color de la luz— para que el reflejo
 * se vea igual en las dos.
 *
 * Con Three.js disponible dibuja los quince haces con el shader; si el equipo
 * no da WebGL cae al lienzo 2D con las cinco bandas y su destello. Ninguna de
 * las dos rutas toca nada fuera del `<canvas id="beams-canvas">`.
 */
(function () {
  "use strict";

  (function initBeamsBackground() {
    var canvas = document.getElementById("beams-canvas");
    if (!canvas) return;

    function initThreeBeams() {
      var THREE = window.THREE;
      if (!THREE || typeof THREE.WebGLRenderer !== "function") return false;

      try {
        var parent = canvas.parentElement || document.body;
        var w = parent.clientWidth || window.innerWidth;
        var h = parent.clientHeight || window.innerHeight;
        var lightColor = "#7fb6ef";
        var speed = 2.2,
          noiseIntensity = 1.6,
          scale = 0.15;
        var beamWidth = 2.5,
          beamHeight = 48,
          beamNumber = 15;

        var noiseGLSL = `
          float random (in vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233)))*43758.5453123); }
          float noise (in vec2 st) {
            vec2 i = floor(st); vec2 f = fract(st);
            float a = random(i); float b = random(i + vec2(1.0, 0.0));
            float c = random(i + vec2(0.0, 1.0)); float d = random(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
          }
          vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
          vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
          vec3 fade(vec3 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}
          float cnoise(vec3 P){
            vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0);
            Pi0 = mod(Pi0, 289.0); Pi1 = mod(Pi1, 289.0);
            vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
            vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
            vec4 iy = vec4(Pi0.yy, Pi1.yy);
            vec4 iz0 = Pi0.zzzz; vec4 iz1 = Pi1.zzzz;
            vec4 ixy = permute(permute(ix) + iy);
            vec4 ixy0 = permute(ixy + iz0); vec4 ixy1 = permute(ixy + iz1);
            vec4 gx0 = ixy0 / 7.0; vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5; gx0 = fract(gx0);
            vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0); vec4 sz0 = step(gz0, vec4(0.0));
            gx0 -= sz0 * (step(0.0, gx0) - 0.5); gy0 -= sz0 * (step(0.0, gy0) - 0.5);
            vec4 gx1 = ixy1 / 7.0; vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5; gx1 = fract(gx1);
            vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1); vec4 sz1 = step(gz1, vec4(0.0));
            gx1 -= sz1 * (step(0.0, gx1) - 0.5); gy1 -= sz1 * (step(0.0, gy1) - 0.5);
            vec3 g000 = vec3(gx0.x,gy0.x,gz0.x); vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
            vec3 g010 = vec3(gx0.z,gy0.z,gz0.z); vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
            vec3 g001 = vec3(gx1.x,gy1.x,gz1.x); vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
            vec3 g011 = vec3(gx1.z,gy1.z,gz1.z); vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
            vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
            g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
            vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
            g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
            float n000 = dot(g000, Pf0);
            float n100 = dot(g100, vec3(Pf1.x,Pf0.yz));
            float n010 = dot(g010, vec3(Pf0.x,Pf1.y,Pf0.z));
            float n110 = dot(g110, vec3(Pf1.xy,Pf0.z));
            float n001 = dot(g001, vec3(Pf0.xy,Pf1.z));
            float n101 = dot(g101, vec3(Pf1.x,Pf0.y,Pf1.z));
            float n011 = dot(g011, vec3(Pf0.x,Pf1.yz));
            float n111 = dot(g111, Pf1);
            vec3 fade_xyz = fade(Pf0);
            vec4 n_z = mix(vec4(n000,n100,n010,n110),vec4(n001,n101,n011,n111),fade_xyz.z);
            vec2 n_yz = mix(n_z.xy,n_z.zw,fade_xyz.y);
            float n_xyz = mix(n_yz.x,n_yz.y,fade_xyz.x);
            return 2.2 * n_xyz;
          }`;

        function hexRGB(hex) {
          var c = hex.replace("#", "");
          return [
            parseInt(c.substr(0, 2), 16) / 255,
            parseInt(c.substr(2, 2), 16) / 255,
            parseInt(c.substr(4, 2), 16) / 255,
          ];
        }

        function stackedGeometry(n, width, height, spacing, hSeg, yMin, yMax) {
          var g = new THREE.BufferGeometry();
          var positions = new Float32Array(n * (hSeg + 1) * 2 * 3);
          var indices = new Uint32Array(n * hSeg * 2 * 3);
          var uvs = new Float32Array(n * (hSeg + 1) * 2 * 2);
          var vo = 0,
            io = 0,
            uo = 0;
          var totalWidth = n * width + (n - 1) * spacing;
          var xBase = -totalWidth / 2;
          yMin = typeof yMin === "number" ? yMin : -height / 2;
          yMax = typeof yMax === "number" ? yMax : height / 2;
          var ySpan = yMax - yMin;
          for (var i = 0; i < n; i++) {
            var xOff = xBase + i * (width + spacing);
            var uvX = Math.random() * 300,
              uvY0 = Math.random() * 300;
            for (var j = 0; j <= hSeg; j++) {
              var y = yMin + (j / hSeg) * ySpan;
              positions.set([xOff, y, 0, xOff + width, y, 0], vo * 3);
              var uvY = j / hSeg;
              uvs.set([uvX, uvY + uvY0, uvX + 1, uvY + uvY0], uo);
              if (j < hSeg) {
                indices.set([vo, vo + 1, vo + 2, vo + 2, vo + 1, vo + 3], io);
                io += 6;
              }
              vo += 2;
              uo += 4;
            }
          }
          g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
          g.setIndex(new THREE.BufferAttribute(indices, 1));
          g.computeVertexNormals();
          return g;
        }

        function extendMaterial(Base, cfg) {
          var physical = THREE.ShaderLib.physical;
          var baseDefines = physical.defines || {};
          var uniforms = THREE.UniformsUtils.clone(physical.uniforms);
          var defaults = new Base(cfg.material || {});
          if (defaults.color) uniforms.diffuse.value = defaults.color;
          if ("roughness" in defaults) uniforms.roughness.value = defaults.roughness;
          if ("metalness" in defaults) uniforms.metalness.value = defaults.metalness;
          if ("envMapIntensity" in defaults)
            uniforms.envMapIntensity.value = defaults.envMapIntensity;
          Object.keys(cfg.uniforms || {}).forEach(function (k) {
            var u = cfg.uniforms[k];
            uniforms[k] = u !== null && typeof u === "object" && "value" in u ? u : { value: u };
          });
          var vert = cfg.header + "\n" + (cfg.vertexHeader || "") + "\n" + physical.vertexShader;
          var frag =
            cfg.header + "\n" + (cfg.fragmentHeader || "") + "\n" + physical.fragmentShader;
          Object.keys(cfg.vertex || {}).forEach(function (inc) {
            vert = vert.replace(inc, inc + "\n" + cfg.vertex[inc]);
          });
          Object.keys(cfg.fragment || {}).forEach(function (inc) {
            frag = frag.replace(inc, inc + "\n" + cfg.fragment[inc]);
          });
          return new THREE.ShaderMaterial({
            defines: Object.assign({}, baseDefines),
            uniforms: uniforms,
            vertexShader: vert,
            fragmentShader: frag,
            lights: true,
            fog: !!(cfg.material && cfg.material.fog),
          });
        }

        var material = extendMaterial(THREE.MeshStandardMaterial, {
          header:
            "varying vec2 vUv; uniform float time; uniform float uSpeed; uniform float uNoiseIntensity; uniform float uScale;\n" +
            noiseGLSL,
          vertexHeader: `
            float getPos(vec3 pos){ vec3 noisePos = vec3(pos.x*0., pos.y-uv.y, pos.z+time*uSpeed*3.)*uScale; return cnoise(noisePos); }
            vec3 getCurrentPos(vec3 pos){ vec3 newpos=pos; newpos.z+=getPos(pos); return newpos; }
            vec3 getNormal(vec3 pos){ vec3 curpos=getCurrentPos(pos); vec3 nX=getCurrentPos(pos+vec3(0.01,0.0,0.0)); vec3 nZ=getCurrentPos(pos+vec3(0.0,-0.01,0.0)); vec3 tX=normalize(nX-curpos); vec3 tZ=normalize(nZ-curpos); return normalize(cross(tZ,tX)); }`,
          vertex: {
            "#include <begin_vertex>": "transformed.z += getPos(transformed.xyz);",
            "#include <beginnormal_vertex>": "objectNormal = getNormal(position.xyz);",
          },
          fragment: {
            "#include <dithering_fragment>":
              "float rn = noise(gl_FragCoord.xy); gl_FragColor.rgb -= rn / 15. * uNoiseIntensity;",
          },
          material: { fog: true },
          uniforms: {
            diffuse: new THREE.Color().fromArray(hexRGB("#000000")),
            time: { value: 0 },
            roughness: 0.3,
            metalness: 0.3,
            uSpeed: { value: speed },
            envMapIntensity: 10,
            uNoiseIntensity: noiseIntensity,
            uScale: scale,
          },
        });

        var geometry = stackedGeometry(beamNumber, beamWidth, 18, 0, 100, -12, 64);
        var mesh = new THREE.Mesh(geometry, material);

        var scene = new THREE.Scene();
        scene.background = new THREE.Color("#000000");
        var group = new THREE.Group();
        group.rotation.z = (45 * Math.PI) / 180;
        group.add(mesh);
        var dir = new THREE.DirectionalLight(lightColor, 1.15);
        dir.position.set(0, 3, 10);
        group.add(dir);
        scene.add(group);
        scene.add(new THREE.AmbientLight(0x13294c, 0.6));

        var camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
        camera.position.set(0, 0, 20);

        var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h, false);

        var clock = new THREE.Clock();
        function animate() {
          material.uniforms.time.value += 0.1 * clock.getDelta();
          renderer.render(scene, camera);
          requestAnimationFrame(animate);
        }
        animate();

        window.addEventListener("resize", function () {
          var pw = parent.clientWidth || window.innerWidth,
            ph = parent.clientHeight || window.innerHeight;
          renderer.setSize(pw, ph, false);
          camera.aspect = pw / ph;
          camera.updateProjectionMatrix();
        });
        return true;
      } catch (e) {
        return false;
      }
    }

    function init2DBeamsFallback() {
      if (typeof canvas.getContext !== "function") return;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      var width = 0,
        height = 0,
        numBeams = 5,
        beams = [];

      function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        beams = [];
        var totalSpan = width * 1.85;
        var step = totalSpan / numBeams;
        for (var i = 0; i < numBeams; i++) {
          beams.push({
            offset: -width * 0.4 + i * step,
            width: 220 + Math.random() * 90,
            angle: Math.PI / 4.25,
            sheenPos: Math.random() * 1000,
            sheenSpeed: 1.4 + Math.random() * 1.0,
            opacity: 0.38 + Math.random() * 0.14,
          });
        }
      }
      window.addEventListener("resize", resize);
      resize();

      var time = 0;
      function animate() {
        time += 0.012;
        ctx.clearRect(0, 0, width, height);

        var bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, "#060607");
        bgGrad.addColorStop(0.5, "#0a0a0c");
        bgGrad.addColorStop(1, "#12161f");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        for (var i = 0; i < beams.length; i++) {
          var b = beams[i];
          b.sheenPos += b.sheenSpeed * 1.8;
          ctx.save();
          var beamX = b.offset + Math.sin(time * 0.2 + i) * 12;
          ctx.translate(beamX, -height * 0.7);
          ctx.rotate(b.angle);
          var beamLength = height * 4.5;

          var bandGrad = ctx.createLinearGradient(-b.width / 2, 0, b.width / 2, 0);
          bandGrad.addColorStop(0, "rgba(8, 25, 48, 0.4)");
          bandGrad.addColorStop(0.15, "rgba(14, 42, 71, " + b.opacity * 1.1 + ")");
          bandGrad.addColorStop(0.5, "rgba(49, 112, 167, " + b.opacity * 0.8 + ")");
          bandGrad.addColorStop(0.85, "rgba(45, 55, 72, " + b.opacity * 1.1 + ")");
          bandGrad.addColorStop(1, "rgba(18, 22, 31, 0.4)");
          ctx.fillStyle = bandGrad;
          ctx.fillRect(-b.width / 2, 0, b.width, beamLength);

          var sheenCenter = (b.sheenPos % (beamLength * 1.4)) - beamLength * 0.2;
          var sheenHeight = 450;
          var sheenGrad = ctx.createLinearGradient(
            0,
            sheenCenter - sheenHeight / 2,
            0,
            sheenCenter + sheenHeight / 2,
          );
          sheenGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
          sheenGrad.addColorStop(0.25, "rgba(86, 150, 206, " + b.opacity * 0.6 + ")");
          sheenGrad.addColorStop(0.5, "rgba(255, 255, 255, " + b.opacity * 1.5 + ")");
          sheenGrad.addColorStop(0.75, "rgba(86, 150, 206, " + b.opacity * 0.6 + ")");
          sheenGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
          ctx.fillStyle = sheenGrad;
          ctx.fillRect(-b.width / 2, sheenCenter - sheenHeight / 2, b.width, sheenHeight);

          ctx.restore();
        }
        requestAnimationFrame(animate);
      }
      animate();
    }

    if (!initThreeBeams()) {
      init2DBeamsFallback();
    }
  })();
})();
