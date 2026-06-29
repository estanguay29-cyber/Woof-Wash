(function () {
  window.WoofWashProductos = window.WoofWashProductos || {};

  window.WoofWashProductos.mascotaGroups = Object.freeze([
    {
      id: "peluche-jirafa",
      nombre: "Peluche jirafa",
      precio: 160,
      imagen: "img/Peluche-jirafa.png",
      descripcion: "Un compañero suave y resistente para horas de diversión. Perfecto para perros que disfrutan abrazar y jugar."
    },
    {
      id: "peluche-perro",
      nombre: "Peluche perro",
      precio: 160,
      descripcion: "Un adorable peluche con textura agradable que convierte cualquier momento en una nueva aventura.",
      variantes: [
        { id: "peluche-perro-cafe", nombre: "Peluche perro café", etiqueta: "Café", imagen: "img/Peluche-perro-café.png" },
        { id: "peluche-perro-verde", nombre: "Peluche perro verde", etiqueta: "Verde", imagen: "img/Peluche-perro-verde.png" }
      ]
    },
    {
      id: "peluche-burro",
      nombre: "Peluche burro",
      precio: 160,
      descripcion: "Un divertido peluche de burro disponible en diferentes colores para que elijas el favorito de tu mejor amigo.",
      variantes: [
        { id: "peluche-burro-azul", nombre: "Peluche burro azul", etiqueta: "Azul", imagen: "img/Peluche-burro-azul.png" },
        { id: "peluche-burro-gris", nombre: "Peluche burro gris", etiqueta: "Gris", imagen: "img/Peluche-burro-gris.png" }
      ]
    },
    {
      id: "bolsita-para-premios",
      nombre: "Bolsita para premios",
      precio: 130,
      imagen: "img/Bolsa-premios.png",
      descripcion: "Lleva siempre los premios de tu mascota de forma práctica durante paseos, entrenamientos o aventuras."
    },
    {
      id: "peluche-mono-arcoiris",
      nombre: "Peluche moño arcoíris",
      precio: 44,
      imagen: "img/Peluche-moño-arcoiris.png",
      descripcion: "Un juguete ligero y colorido perfecto para juegos diarios."
    },
    {
      id: "peluche-estrella",
      nombre: "Peluche estrella",
      precio: 44,
      descripcion: "Una estrella suave llena de color para hacer cada momento de juego todavía más divertido.",
      variantes: [
        { id: "peluche-estrella-azul", nombre: "Peluche estrella azul", etiqueta: "Azul", imagen: "img/Peluche-estrella-azul.png" },
        { id: "peluche-estrella-amarilla", nombre: "Peluche estrella amarilla", etiqueta: "Amarilla", imagen: "img/Peluche-estrella-amarilla.png" }
      ]
    },
    {
      id: "peluche-muslo-pollo",
      nombre: "Peluche muslo de pollo",
      precio: 44,
      imagen: "img/Peluche-muslo-pollo.png",
      descripcion: "El clásico juguete con un diseño divertido que despierta la curiosidad de cualquier perrito."
    },
    {
      id: "peluche-pollo",
      nombre: "Peluche Pollo",
      precio: 200,
      imagen: "img/Peluche-pollo.png",
      descripcion: "Peluche suave tipo pollo, ideal para juego y mordida ligera de mascotas."
    },
    {
      id: "pechera-mezclilla",
      nombre: "Pechera Mezclilla",
      precio: 330,
      descripcion: "Pechera de mezclilla para mascota, comoda, resistente y con estilo.",
      tipoVariante: "talla",
      variantes: [
        { id: "pechera-mezclilla-mediana", nombre: "Pechera Mezclilla Mediana", etiqueta: "Mediana", imagen: "img/Peluche-pechera.png" }
      ]
    },
    {
      id: "peluche-leon",
      nombre: "Peluche Leon",
      precio: 150,
      imagen: "img/Peluche-leon.png",
      descripcion: "Peluche suave tipo leon, ideal para juego, compania y mordida ligera."
    },
    {
      id: "peluche-fresa",
      nombre: "Peluche fresa",
      precio: 44,
      imagen: "img/Peluche-fresa.png",
      descripcion: "Pequeño, suave y perfecto para perros que aman cargar sus juguetes por toda la casa."
    },
    {
      id: "plato-extensible",
      nombre: "Plato extensible",
      precio: 170,
      imagen: "img/Plato-extendible.png",
      descripcion: "Ideal para viajes y paseos. Se despliega fácilmente y ocupa muy poco espacio."
    },
    {
      id: "juguete-cuerda-larga",
      nombre: "Juguete cuerda larga",
      precio: 74,
      imagen: "img/Juguete-cuerda-larga.png",
      descripcion: "Ideal para juegos de jaloneo y fortalecer el vínculo entre tú y tu mascota."
    },
    {
      id: "juguete-cuerda-mediana",
      nombre: "Juguete cuerda mediana",
      precio: 74,
      imagen: "img/Juguete-cuerda-mediana.png",
      descripcion: "El tamaño perfecto para juegos diarios llenos de energía."
    },
    {
      id: "juguete-cuerda-redonda",
      nombre: "Juguete cuerda redonda",
      precio: 74,
      imagen: "img/Juguete-cuerda-bola.png",
      descripcion: "Una divertida pelota de cuerda diseñada para lanzar, atrapar y morder."
    },
    {
      id: "correa",
      nombre: "Correa",
      precio: 90,
      descripcion: "Correas resistentes y cómodas disponibles en varios colores para acompañar cada paseo.",
      variantes: [
        { id: "correa-rosa", nombre: "Correa rosa", etiqueta: "Rosa", imagen: "img/Correa-Rosa.png" },
        { id: "correa-negra", nombre: "Correa negra", etiqueta: "Negra", imagen: "img/Correa-negra.png" },
        { id: "correa-azul", nombre: "Correa azul", etiqueta: "Azul", imagen: "img/Correa-azul.png" },
        { id: "correa-roja", nombre: "Correa roja", etiqueta: "Roja", imagen: "img/Correa-roja.png" }
      ]
    },
    {
      id: "peluche-hueso-arcoiris",
      nombre: "Peluche hueso arcoíris",
      precio: 44,
      imagen: "img/Peluche-hueso-arcoiris.png",
      descripcion: "Un huesito lleno de color que hará cada juego mucho más divertido."
    },
    {
      id: "peluche-nube",
      nombre: "Peluche nube",
      precio: 44,
      descripcion: "Una nube increíblemente suave para los perros que disfrutan juguetes tiernos y ligeros.",
      variantes: [
        { id: "peluche-nube-blanca", nombre: "Peluche nube blanca", etiqueta: "Blanca", imagen: "img/Peluche-nube-blanca.png" },
        { id: "peluche-nube-rosa", nombre: "Peluche nube rosa", etiqueta: "Rosa", imagen: "img/Peluche-nube-rosa.png" }
      ]
    },
    {
      id: "peluche-corazon-rosa",
      nombre: "Peluche corazón rosa",
      precio: 44,
      imagen: "img/Peluche-corazon-rosa.png",
      descripcion: "Porque el mejor amigo también merece un juguete lleno de cariño."
    }
  ]);
})();
