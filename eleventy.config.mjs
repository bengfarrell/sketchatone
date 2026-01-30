import { EleventyRenderPlugin, EleventyHtmlBasePlugin } from "@11ty/eleventy";
import syntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";
import * as path from 'path';
import { readFileSync } from 'fs';
const pathResolver = path.posix;

// Read package.json for version
const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

export default async function(eleventyConfig) {
  eleventyConfig.addPlugin(EleventyRenderPlugin);

  eleventyConfig.addGlobalData('version', packageJson.version);

  // Copy the contents of the `public` folder to the output folder
  eleventyConfig.addPassthroughCopy({
    "./docs-src/public/": `/`,
  });

  eleventyConfig.addGlobalData("layout", "page.njk");
  eleventyConfig.setUseGitIgnore(false);

  // Watch content images for the image pipeline.
  eleventyConfig.addWatchTarget("docs-src/**/*.{svg,webp,png,jpeg}");

  // Official plugins
  eleventyConfig.addPlugin(syntaxHighlight, {
    preAttributes: { tabindex: 0 }
  });
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

  eleventyConfig.addFilter('resolvePath', function (base, p) {
    const relativePath = pathResolver.relative(base, p);
    if (p.endsWith('/') && !relativePath.endsWith('/') && relativePath !== '') {
      return relativePath + '/';
    }
    return relativePath;
  });

  return {
    templateFormats: [
      "md",
      "njk",
      "html",
      "liquid",
    ],

    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",

    dir: {
      input: "docs-src",
      includes: "_includes",
      data: "_data",
      output: "docs"
    },

    pathPrefix: "/sketchatone/"
  };
}
