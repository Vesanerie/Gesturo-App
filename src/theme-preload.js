// Appliquer le thème AVANT le premier paint pour éviter un flash dark→light.
// Lu en localStorage (clé gd4_theme). Valeurs : 'light' | 'dark' (défaut dark).
(function() {
  try {
    if (localStorage.getItem('gd4_theme') === 'light') {
      document.documentElement.classList.add('theme-light-preload');
      document.addEventListener('DOMContentLoaded', function() {
        document.body.classList.add('theme-light');
        document.documentElement.classList.remove('theme-light-preload');
      });
    }
  } catch (e) {}
})();
