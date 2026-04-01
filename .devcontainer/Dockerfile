ARG VARIANT="bookworm"
FROM mcr.m.daocloud.io/devcontainers/base:${VARIANT}

ARG APT_MIRROR="https://mirrors.tuna.tsinghua.edu.cn/debian"
ARG APT_SECURITY_MIRROR="https://mirrors.tuna.tsinghua.edu.cn/debian-security"

ENV NVM_NODEJS_ORG_MIRROR="https://npmmirror.com/mirrors/node"
ENV NPM_CONFIG_REGISTRY="https://registry.npmmirror.com"
ENV GOPROXY="https://goproxy.cn,direct"

# Switch Debian package sources before devcontainer features install packages.
RUN set -eux; \
    sources_file="/etc/apt/sources.list.d/debian.sources"; \
    legacy_sources="/etc/apt/sources.list"; \
    rewrite_sources() { \
      local target="$1"; \
      sed -i \
        -e "s|http://deb.debian.org/debian|${APT_MIRROR}|g" \
        -e "s|https://deb.debian.org/debian|${APT_MIRROR}|g" \
        -e "s|http://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
        -e "s|https://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
        -e "s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
        -e "s|https://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
        "${target}"; \
    }; \
    if [ -f "${sources_file}" ]; then \
      cp "${sources_file}" "${sources_file}.bak"; \
      rewrite_sources "${sources_file}"; \
    elif [ -f "${legacy_sources}" ]; then \
      cp "${legacy_sources}" "${legacy_sources}.bak"; \
      rewrite_sources "${legacy_sources}"; \
    fi; \
    apt-get update
