(() => {
  const currentPath = window.location.pathname;
  document.querySelectorAll('.site-nav a').forEach((link) => {
    const linkUrl = new URL(link.href, window.location.origin);
    const linkPath = linkUrl.pathname;
    const isHomeRoute = currentPath === '/' && linkUrl.hash === '#home';
    const isExactRoute = !linkUrl.hash && linkPath === currentPath;
    if (isHomeRoute || isExactRoute) link.setAttribute('aria-current', 'page');
  });

  window.lucide?.createIcons();
})();
