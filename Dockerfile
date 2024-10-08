FROM node:18.17-bullseye as base

# AFJ specific setup
WORKDIR /www
ENV RUN_MODE="docker"

COPY package.json package.json
COPY yarn.lock yarn.lock

# Run install after copying only dependency file
# to make use of docker layer caching
RUN yarn install

#Copy other depdencies
COPY ./src ./src
COPY tsconfig.json tsconfig.json
COPY jest.config.js jest.config.js


RUN yarn build

CMD [ "yarn","start"]
