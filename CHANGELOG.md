# Changelog

## [1.4.0](https://github.com/2060-io/didcomm-mediator/compare/v1.3.0...v1.4.0) (2025-12-02)


### Features

* Add integration [@2060](https://github.com/2060).io/credo-ts-didcomm-shorten-url package ([#39](https://github.com/2060-io/didcomm-mediator/issues/39)) ([0ccf976](https://github.com/2060-io/didcomm-mediator/commit/0ccf976cbe193adbd8a0cc6784c18a14a77fd547))
* release updated shorten-url integration ([#43](https://github.com/2060-io/didcomm-mediator/issues/43)) ([d7e6216](https://github.com/2060-io/didcomm-mediator/commit/d7e621682be41c74e8c7243b58c6ec6b7f34066f))
* Upgrade shorten-url package 0.0.11 ([#44](https://github.com/2060-io/didcomm-mediator/issues/44)) ([dced779](https://github.com/2060-io/didcomm-mediator/commit/dced77998781338bc5f933eb4fd808af3e9485e8))


### Bug Fixes

* handle expiration records in seconds and delete if expire ([#41](https://github.com/2060-io/didcomm-mediator/issues/41)) ([e4c18ef](https://github.com/2060-io/didcomm-mediator/commit/e4c18efbfb396a448c02d1bf496b95f25175a6d8))

## [1.3.0](https://github.com/2060-io/didcomm-mediator/compare/v1.2.1...v1.3.0) (2025-07-16)


### Features

* Update message pickup repository postgres 0.0.15 ([#34](https://github.com/2060-io/didcomm-mediator/issues/34)) ([6ec19b1](https://github.com/2060-io/didcomm-mediator/commit/6ec19b1b8c0ad9a83c63ab7364ffb787035611dd))


### Bug Fixes

* Add "v" to version push helm chart to docker hub OCI ([#36](https://github.com/2060-io/didcomm-mediator/issues/36)) ([9395cf3](https://github.com/2060-io/didcomm-mediator/commit/9395cf3fba0ad621214f207dad12dc99bfb03c77))

## [1.2.1](https://github.com/2060-io/didcomm-mediator/compare/v1.2.0...v1.2.1) (2025-07-10)


### Bug Fixes

* Fix image charts template with Chart.Version ([#32](https://github.com/2060-io/didcomm-mediator/issues/32)) ([e5d3d47](https://github.com/2060-io/didcomm-mediator/commit/e5d3d47b5f578b1f2b8ee6697c6fd6a84fc263b0))

## [1.2.0](https://github.com/2060-io/didcomm-mediator/compare/v1.1.0...v1.2.0) (2025-07-09)


### Features

* Upgrade credo-ts-message-pickup-respository-pg v0.0.14 ([#31](https://github.com/2060-io/didcomm-mediator/issues/31)) ([194417b](https://github.com/2060-io/didcomm-mediator/commit/194417b22dadfb890f98ff3d05f16ce3b88898f1))


### Bug Fixes

* Fix image with chart version and remove unnecessary variables ([#28](https://github.com/2060-io/didcomm-mediator/issues/28)) ([167800d](https://github.com/2060-io/didcomm-mediator/commit/167800de5951b9c6867d1383c7b1e97540f14044))
* use exact packaged filename for Helm OCI push ([#30](https://github.com/2060-io/didcomm-mediator/issues/30)) ([91c902a](https://github.com/2060-io/didcomm-mediator/commit/91c902a5006afebe44cabc9f3cc2b87f06685348))

## [1.1.0](https://github.com/2060-io/didcomm-mediator/compare/v1.0.0...v1.1.0) (2025-07-01)


### Features

* add handle max receive bytes messages to MRP client ([#7](https://github.com/2060-io/didcomm-mediator/issues/7)) ([773d2e5](https://github.com/2060-io/didcomm-mediator/commit/773d2e50f2e9d1276ec130277cae92889d827b14))
* Add headers to APNs resolve issue 21 ([#22](https://github.com/2060-io/didcomm-mediator/issues/22)) ([01623a5](https://github.com/2060-io/didcomm-mediator/commit/01623a56784133c7f1c7e23602eb9e5b938715ce))
* add support for configurable persistence postgres methods in Didcomm Mediator ([#10](https://github.com/2060-io/didcomm-mediator/issues/10)) ([024285d](https://github.com/2060-io/didcomm-mediator/commit/024285d736862d3548a9265b7895827312452459))
* Apply new feat to the messages pickup repository client ([#6](https://github.com/2060-io/didcomm-mediator/issues/6)) ([2d098ff](https://github.com/2060-io/didcomm-mediator/commit/2d098ffcbff4df1754b9fb12409f12089fa97fff))
* Implements the setConnectionInfo callback function of the MPR client ([#8](https://github.com/2060-io/didcomm-mediator/issues/8)) ([e43d006](https://github.com/2060-io/didcomm-mediator/commit/e43d0062f045511350ac596c05c77b330285e893))
* Update getConnectionInfo callback to support handle type pushNotification ([#12](https://github.com/2060-io/didcomm-mediator/issues/12)) ([6d85767](https://github.com/2060-io/didcomm-mediator/commit/6d857670807739fb0701c067780f9323f1254c88))
* Update Message Pickup Repository package to version 0.0.12 ([#18](https://github.com/2060-io/didcomm-mediator/issues/18)) ([c4cc510](https://github.com/2060-io/didcomm-mediator/commit/c4cc510565f0d2fad47cbc1c72a2bd6b40a60fa6))
* Update package [@2060](https://github.com/2060).io/credo-ts-message-pickup-repository-pg 0.0.11 ([#17](https://github.com/2060-io/didcomm-mediator/issues/17)) ([bb861e8](https://github.com/2060-io/didcomm-mediator/commit/bb861e8fdf209fccdb5c071495eef663154a563f))
* Upgrade message pickup repository postgres ([#15](https://github.com/2060-io/didcomm-mediator/issues/15)) ([f9e4d3f](https://github.com/2060-io/didcomm-mediator/commit/f9e4d3fc3fcd881d1688a558aef1b3904318e967))
* Upgrade package message-repository-pg 0.0.13 ([#19](https://github.com/2060-io/didcomm-mediator/issues/19)) ([0ea211c](https://github.com/2060-io/didcomm-mediator/commit/0ea211c7a99b2b40b5fdb79b1330526edea1e2b8))
* use Message Pickup Repository client  ([#5](https://github.com/2060-io/didcomm-mediator/issues/5)) ([8ab41af](https://github.com/2060-io/didcomm-mediator/commit/8ab41af78a1286e57bb2c84c039e3058a9d28c66))


### Bug Fixes

* add helm charts ([#20](https://github.com/2060-io/didcomm-mediator/issues/20)) ([8509c97](https://github.com/2060-io/didcomm-mediator/commit/8509c976144893a496565112a76b3e3c04ac29d8))
* Update credo-ts-message-pickup-repository-pg version 0.0.10 ([#16](https://github.com/2060-io/didcomm-mediator/issues/16)) ([900ee00](https://github.com/2060-io/didcomm-mediator/commit/900ee0011a5524847010b42dc66b540238dd04da))
