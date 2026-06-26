(function () {
  window.WoofWashProductos = window.WoofWashProductos || {};

  const normalizarGrupos = (grupos) => Array.isArray(grupos) ? grupos : [];

  const flattenGroups = (grupos) => normalizarGrupos(grupos).flatMap((producto) => {
    if (!Array.isArray(producto.variantes) || producto.variantes.length === 0) {
      return [{ ...producto, productoBaseId: producto.id }];
    }

    return producto.variantes.map((variante) => ({
      ...producto,
      ...variante,
      productoBaseId: producto.id,
      precio: producto.precio,
      descripcion: producto.descripcion
    }));
  });

  const mascotaGroups = normalizarGrupos(window.WoofWashProductos.mascotaGroups);
  const autoGroups = normalizarGrupos(window.WoofWashProductos.autoGroups);
  const mascotaItems = flattenGroups(mascotaGroups);
  const autoItems = flattenGroups(autoGroups);
  const catalogoItems = [...mascotaItems, ...autoItems];

  const catalogo = Object.freeze(catalogoItems.reduce((acc, producto) => {
    acc[producto.id] = Object.freeze({
      id: producto.id,
      nombre: producto.nombre,
      precio: producto.precio,
      imagen: producto.imagen || ""
    });
    return acc;
  }, {}));

  const porNombre = Object.freeze(Object.values(catalogo).reduce((acc, producto) => {
    acc[producto.nombre] = producto;
    return acc;
  }, {}));

  window.WoofWashProductos.mascotaItems = Object.freeze(mascotaItems);
  window.WoofWashProductos.autoItems = Object.freeze(autoItems);
  window.WoofWashProductos.catalogo = catalogo;
  window.WoofWashProductos.porNombre = porNombre;
})();
