FROM node:18.17-bullseye as base

# AFJ specific setup
WORKDIR /www
ENV RUN_MODE="docker"

COPY package.json package.json
COPY yarn.lock yarn.lock
COPY ./patches ./patches

# Run install after copying only dependency file
# to make use of docker layer caching
RUN yarn install

#Copy other depdencies
COPY ./src ./src
COPY tsconfig.json tsconfig.json
COPY jest.config.js jest.config.js
#COPY firebase-cfg.json firebase-cfg.json


RUN yarn build

CMD [ "yarn","start"]
