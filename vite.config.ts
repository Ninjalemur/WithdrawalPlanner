import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Base path must match the GitHub repository name for GitHub Pages project pages.
// e.g. https://<username>.github.io/WithdrawalPlanner/
export default defineConfig({
  plugins: [svelte()],
  base: '/WithdrawalPlanner/',
})
