#ifndef GLOWBE_UDP_H
#define GLOWBE_UDP_H

#include <Arduino.h>

extern "C" {
#include "lwip/sockets.h"
}

namespace glowbe::udp {

inline int& fd() {
  static int s_fd = -1;
  return s_fd;
}

inline bool listen(uint16_t port) {
  if (fd() >= 0) {
    close(fd());
    fd() = -1;
  }

  const int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
  if (sock < 0) {
    return false;
  }

  int yes = 1;
  setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

  sockaddr_in addr = {};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(port);
  addr.sin_addr.s_addr = static_cast<uint32_t>(WiFi.localIP());

  if (bind(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
    addr.sin_addr.s_addr = INADDR_ANY;
    if (bind(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
      close(sock);
      return false;
    }
  }

  fd() = sock;
  return true;
}

inline int recv(uint8_t* buf, size_t max_len, IPAddress* from = nullptr) {
  if (fd() < 0) {
    return -1;
  }
  sockaddr_in peer = {};
  socklen_t peer_len = sizeof(peer);
  const int n = ::recvfrom(fd(), buf, max_len, MSG_DONTWAIT, reinterpret_cast<sockaddr*>(&peer),
                           &peer_len);
  if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
    return -2;
  }
  if (n > 0 && from != nullptr) {
    *from = IPAddress(peer.sin_addr.s_addr);
  }
  return n;
}

inline bool send(const uint8_t* data, size_t len, const IPAddress& ip, uint16_t port) {
  if (fd() < 0) {
    return false;
  }
  sockaddr_in to = {};
  to.sin_family = AF_INET;
  to.sin_port = htons(port);
  to.sin_addr.s_addr = static_cast<uint32_t>(ip);
  const int sent =
      ::sendto(fd(), data, len, 0, reinterpret_cast<sockaddr*>(&to), sizeof(to));
  return sent == static_cast<int>(len);
}

}  // namespace glowbe::udp

#endif
