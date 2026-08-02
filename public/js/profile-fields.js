(() => {
  const comboboxes = new WeakMap();

  function countryOptions(select) {
    return [...(select?.options || [])]
      .filter((option) => option.value)
      .map((option) => ({ code: option.value, name: option.textContent.trim() }));
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

  function chooseCountry(state, country) {
    state.select.value = country.code;
    state.input.value = country.name;
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
      const option = document.createElement('button');
      option.id = `${state.input.id}-option-${index}`;
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.countryCode = country.code;
      option.textContent = country.name;
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => chooseCountry(state, country));
      state.suggestions.appendChild(option);
    });
    state.suggestions.classList.toggle('hidden', matches.length === 0);
    state.input.setAttribute('aria-expanded', String(matches.length > 0));
  }

  function refreshCountryCombobox(root) {
    if (!root) return null;
    const input = root.querySelector('input[type="search"]');
    const select = root.querySelector('select[data-country-value], select[name="countryCode"]');
    const suggestions = root.querySelector('[role="listbox"]');
    if (!input || !select || !suggestions) return null;
    const existing = comboboxes.get(root);
    if (existing) {
      existing.options = countryOptions(select);
      const selected = existing.options.find((country) => country.code === select.value);
      if (selected && document.activeElement !== input) input.value = selected.name;
      if (!selected && document.activeElement !== input) input.value = '';
      return existing;
    }

    const state = {
      root,
      input,
      select,
      suggestions,
      options: countryOptions(select),
      activeIndex: -1
    };
    comboboxes.set(root, state);
    const selected = state.options.find((country) => country.code === select.value);
    if (selected) input.value = selected.name;

    input.addEventListener('input', () => {
      const typed = input.value.trim().toLocaleLowerCase();
      const selectedCountry = state.options.find((country) => country.code === select.value);
      if (!selectedCountry || selectedCountry.name.toLocaleLowerCase() !== typed) select.value = '';
      renderSuggestions(state);
    });
    input.addEventListener('focus', () => renderSuggestions(state));
    input.addEventListener('keydown', (event) => {
      const options = [...suggestions.querySelectorAll('[role="option"]')];
      if (event.key === 'Escape') {
        hideSuggestions(state);
        return;
      }
      if (!options.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'ArrowDown') setActiveOption(state, options, state.activeIndex + 1);
      if (event.key === 'ArrowUp') {
        setActiveOption(state, options, state.activeIndex < 0 ? options.length - 1 : state.activeIndex - 1);
      }
      if (event.key === 'Enter' && state.activeIndex >= 0) {
        const country = state.options.find(
          (item) => item.code === options[state.activeIndex].dataset.countryCode
        );
        if (country) chooseCountry(state, country);
      }
    });
    input.addEventListener('blur', () => hideSuggestions(state));
    return state;
  }

  function initGenderChoices(root) {
    const select = root?.querySelector('select[name="gender"]');
    const buttons = [...(root?.querySelectorAll('[data-choice-value]') || [])];
    if (!select || !buttons.length || root.dataset.genderReady === 'true') return;
    root.dataset.genderReady = 'true';
    const sync = (value, { emit = true } = {}) => {
      select.value = value;
      buttons.forEach((button) => {
        const selected = button.dataset.choiceValue === value;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      if (emit) select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    root._setGenderChoice = (value) => sync(value);
    buttons.forEach((button) => button.addEventListener('click', () => sync(button.dataset.choiceValue)));
    sync(select.value, { emit: false });
  }

  window.refreshCountryCombobox = refreshCountryCombobox;
  window.setGenderChoiceValue = (root, value) => root?._setGenderChoice?.(value);
  document.querySelectorAll('[data-country-combobox]').forEach(refreshCountryCombobox);
  document.querySelectorAll('[data-gender-choices]').forEach(initGenderChoices);
})();
