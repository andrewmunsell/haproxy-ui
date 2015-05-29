FROM haproxy:latest
MAINTAINER Andrew Munsell <andrew@wizardapps.net>

RUN apt-get update -qq
RUN apt-get install curl -y -qq
RUN curl -sL https://deb.nodesource.com/setup | bash -
RUN apt-get install nodejs -qq

RUN mkdir -p /var/local/app

ADD . /var/local/app
WORKDIR /var/local/app

RUN npm install

# Storage folder for the configuration data
VOLUME /var/local/haproxy-ui

EXPOSE 80
EXPOSE 443

CMD ["node", "src/index.js"]