
exports.obtenerVideos = (req, res) => {
  const videos = [
    { id: 1, titulo: "Introducción al adiestramiento", url: "https://example.com/video1" },
    { id: 2, titulo: "Técnicas básicas de obediencia", url: "https://example.com/video2" },
    { id: 3, titulo: "Corrección de conductas", url: "https://example.com/video3" }
  ];

  res.status(200).json(videos);
};
