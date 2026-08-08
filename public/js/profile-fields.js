(() => {
  const FLAG_ICON_ROOT = '/vendor/flag-icons-7.5.0';
  const comboboxes = new WeakMap();
  let countryCatalogPromise;

  function loadCountryCatalog() {
    if (!countryCatalogPromise) {
      countryCatalogPromise = fetch(`${FLAG_ICON_ROOT}/country.json`, {
        headers: { Accept: 'application/json' }
      })
        .then((response) => {
          if (!response.ok) throw new Error('Country catalog unavailable');
          return response.json();
        })
        .then((entries) => entries
          .filter((entry) => entry?.iso === true || entry?.code === 'xk')
          .filter((entry) => entry?.code && entry?.name && entry?.flag_4x3)
          .map((entry) => ({
            code: String(entry.code).toLowerCase(),
            name: entry.name,
            flagPath: entry.flag_4x3
          }))
          .sort((left, right) => left.name.localeCompare(right.name)));
    }
    return countryCatalogPromise;
  }

  function createCountryFlag(country) {
    const image = document.createElement('img');
    image.className = 'country-flag-icon';
    image.src = `${FLAG_ICON_ROOT}/${country.flagPath}`;
    image.alt = '';
    image.loading = 'lazy';
    image.setAttribute('aria-hidden', 'true');
    return image;
  }

  function clearActiveOption(state) {
    state.activeIndex = -1;
    state.input.removeAttribute('aria-activedescendant');
  }

  function hideSuggestions(state) {
    state.suggestions.classList.add('hidden');
    state.input.setAttribute('aria-expanded', 'false');
    clearActiveOption(state);
  }

  function renderSelection(state, country) {
    state.selectedFlag?.replaceChildren();
    state.selectedFlag?.classList.toggle('hidden', !country);
    state.searchIcon?.classList.toggle('hidden', Boolean(country));
    if (country) {
      state.selectedFlag?.append(createCountryFlag(country));
      state.input.value = country.name;
      state.input.setCustomValidity('');
    } else if (document.activeElement !== state.input) {
      state.input.value = '';
      state.input.setCustomValidity(state.input.dataset.invalidMessage || '');
    }
  }

  function chooseCountry(state, country) {
    state.select.value = country.code;
    renderSelection(state, country);
    hideSuggestions(state);
    state.select.dispatchEvent(new Event('change', { bubbles: true }));
    state.input.focus();
  }

  function setActiveOption(state, options, index) {
    state.activeIndex = Math.max(0, Math.min(index, options.length - 1));
    options.forEach((option, optionIndex) => {
      const selected = optionIndex === state.activeIndex;
      option.setAttribute('aria-selected', String(selected));
      if (selected) {
        state.input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView?.({ block: 'nearest' });
      }
    });
  }

  function createCountryOption(state, country, index) {
    const option = document.createElement('button');
    option.id = `${state.input.id}-option-${index}`;
    option.type = 'button';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.dataset.countryCode = country.code;
    const label = document.createElement('strong');
    label.textContent = country.name;
    option.append(createCountryFlag(country), label);
    option.addEventListener('pointerdown', (event) => event.preventDefault());
    option.addEventListener('click', () => chooseCountry(state, country));
    return option;
  }

  function renderSuggestions(state) {
    const query = state.input.value.trim().toLocaleLowerCase();
    state.suggestions.replaceChildren();
    clearActiveOption(state);
    if (query.length < 2) {
      hideSuggestions(state);
      return;
    }
    const matches = state.options
      .filter((country) => country.name.toLocaleLowerCase().includes(query))
      .slice(0, 12);
    matches.forEach((country, index) => {
      state.suggestions.append(createCountryOption(state, country, index));
    });
    state.suggestions.classList.toggle('hidden', matches.length === 0);
    state.input.setAttribute('aria-expanded', String(matches.length > 0));
  }

  async function refreshCountryCombobox(root) {
    if (!root) return null;
    const input = root.querySelector('input[type="search"]');
    const select = root.querySelector('select[data-country-value], select[name="countryCode"]');
    const suggestions = root.querySelector('[role="listbox"]');
    if (!input || !select || !suggestions) return null;
    const catalog = await loadCountryCatalog().catch(() => []);
    const allowedCodes = new Set([...select.options].filter((option) => option.value).map((option) => option.value.toLowerCase()));
    const options = allowedCodes.size ? catalog.filter((country) => allowedCodes.has(country.code)) : catalog;
    const existing = comboboxes.get(root);
    if (existing) {
      existing.options = options;
      renderSelection(existing, options.find((country) => country.code === select.value.toLowerCase()));
      return existing;
    }

    const state = {
      root,
      input,
      select,
      suggestions,
      selectedFlag: root.querySelector('.profile-country-selected-flag'),
      searchIcon: root.querySelector('.profile-country-search-icon'),
      options,
      activeIndex: -1
    };
    comboboxes.set(root, state);
    root.dataset.countryReady = 'true';
    renderSelection(state, options.find((country) => country.code === select.value.toLowerCase()));

    input.addEventListener('input', () => {
      const typed = input.value.trim().toLocaleLowerCase();
      const selectedCountry = state.options.find((country) => country.code === select.value.toLowerCase());
      if (!selectedCountry || selectedCountry.name.toLocaleLowerCase() !== typed) {
        select.value = '';
        input.setCustomValidity(input.dataset.invalidMessage || '');
        state.selectedFlag?.replaceChildren();
        state.selectedFlag?.classList.add('hidden');
        state.searchIcon?.classList.remove('hidden');
      }
      renderSuggestions(state);
    });
    input.addEventListener('focus', () => renderSuggestions(state));
    input.addEventListener('keydown', (event) => {
      const renderedOptions = [...suggestions.querySelectorAll('[role="option"]')];
      if (event.key === 'Escape') {
        hideSuggestions(state);
        return;
      }
      if (!renderedOptions.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'ArrowDown') setActiveOption(state, renderedOptions, state.activeIndex + 1);
      if (event.key === 'ArrowUp') {
        setActiveOption(state, renderedOptions, state.activeIndex < 0 ? renderedOptions.length - 1 : state.activeIndex - 1);
      }
      if (event.key === 'Enter' && state.activeIndex >= 0) {
        const country = state.options.find(
          (item) => item.code === renderedOptions[state.activeIndex].dataset.countryCode
        );
        if (country) chooseCountry(state, country);
      }
    });
    input.addEventListener('blur', () => window.setTimeout(() => hideSuggestions(state), 140));
    select.addEventListener('change', () => {
      renderSelection(state, state.options.find((country) => country.code === select.value.toLowerCase()));
    });
    return state;
  }

  window.refreshCountryCombobox = refreshCountryCombobox;
  document.querySelectorAll('[data-country-combobox]').forEach(refreshCountryCombobox);
})();
