// Arquivos mínimos para os testes de upload. Só os bytes iniciais importam para o file-type.

// PNG 1x1 válido.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// Cabeçalho JPEG (SOI + APP0 "JFIF") seguido de preenchimento.
export const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0', 'latin1'),
  Buffer.alloc(64),
]);

// Contêiner RIFF/WEBP com bloco VP8.
export const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1'),
  Buffer.alloc(64),
]);

// Formato de imagem não aceito.
export const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(64)]);

// Texto qualquer (será enviado como se fosse JPEG).
export const TEXTO = Buffer.from('isto não é uma imagem, apesar do nome foto.jpg');

// PNG válido completado com zeros até o tamanho pedido (para testar o limite de 5 MB).
export function pngComTamanho(bytes: number): Buffer {
  return Buffer.concat([PNG, Buffer.alloc(bytes - PNG.length)]);
}
