const initSelector = (selectId, multibandInstance, onStyleChange) => {
  const select = document.getElementById(selectId);

  if (!select) {
    console.error(`[Selector] Element with id "${selectId}" not found`);
    return;
  }

  const styles = multibandInstance.getStyles().slice().sort((a, b) => a.localeCompare(b));
  select.innerHTML = '';

  styles.forEach(styleName => {
    const option = document.createElement('option');
    option.value = styleName;
    option.textContent = styleName;
    select.appendChild(option);
  });


  const activeStyle = multibandInstance.getActiveStyle();
  select.value = activeStyle;

  // Handle style changes
  select.addEventListener('change', (e) => {
    const newStyle = e.target.value;

    if (typeof onStyleChange === 'function') {
      onStyleChange(newStyle);
    }
  });

};

export { initSelector };
