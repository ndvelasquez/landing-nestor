# Deploy Instructions - Nestor Portfolio

## 🚀 Deploy a Vercel

### Opción 1: Con Vercel CLI (Recomendada)

1. **Login a Vercel:**
   ```bash
   vercel login
   ```

2. **Build del proyecto:**
   ```bash
   cd /root/.openclaw/workspace/landing
   npm run build
   ```

3. **Deploy:**
   ```bash
   vercel deploy --prod
   ```

### Opción 2: Vercel Dashboard

1. Ve a <https://vercel.com/dashboard>
2. Click en **"Add New..."** → **"Project"**
3. Importa desde GitHub o sube el contenido de `/dist`
4. Configura:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
5. Click en **"Deploy"**

### Opción 3: GitHub + Vercel (Automático)

1. **Push a GitHub:**
   ```bash
   cd /root/.openclaw/workspace/landing
   git init
   git add .
   git commit -m "Portfolio dark theme - Stitch MCP design"
   git remote add origin https://github.com/TU_USUARIO/portfolio.git
   git push -u origin main
   ```

2. **Conecta en Vercel:**
   - Ve a <https://vercel.com/new>
   - Importa el repo de GitHub
   - Vercel detectará Astro automáticamente
   - Deploy automático en cada push

---

## 📁 Archivos para Deploy

Los archivos estáticos generados están en:
```
/root/.openclaw/workspace/landing/dist/
```

Puedes subir este contenido directamente a cualquier hosting estático:
- Vercel
- Netlify
- GitHub Pages
- Cloudflare Pages

---

## 🎨 Diseño Generado con Stitch MCP

Este portafolio fue diseñado usando **Google Stitch MCP** con el sistema de diseño **"Digital Curator"**.

**Project ID en Stitch:** `218172157215148328`  
**Screen ID:** `f339148efaca491194be5a838f7d07b1`

**Características:**
- Tema oscuro profesional (#131313)
- Gradientes cyan-teal (#44d8f1, #70d8c8)
- Tipografía Manrope
- Iconos Material Symbols
- Animaciones fluidas scroll-based
- Navegación sticky glassmórfica
- 5 secciones: Hero, About, Skills, Projects, Contact

---

## 📝 Personalización

### Cambiar email de contacto
Edita `src/pages/index.astro`, línea ~170:
```html
<span class="text-lg font-medium">ndvelasquezl@gmail.com</span>
```

### Actualizar links de redes sociales
Edita `src/pages/index.astro`, líneas ~185-190:
```html
<a href="https://www.linkedin.com/in/nestor-david-velasquez/" ...>LinkedIn</a>
<a href="https://github.com/ndvelasquez" ...>GitHub</a>
```

### Modificar skills
Edita `src/pages/index.astro`, sección `#skills` (líneas ~95-145):
```html
<!-- Agrega o modifica skills -->
<div class="space-y-4">
  <span>Tu Skill</span>
  <span>XX%</span>
  <div class="h-[2px] ...">...</div>
</div>
```

---

**Última actualización:** 2026-03-22  
**Diseñado con:** Stitch MCP + Google Stitch API
