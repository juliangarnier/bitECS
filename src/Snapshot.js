export const Snapshot = (registry, getEntityCount, getEntityCursor) => {

  /**
   * Saves a snapshot of the ECS in its current state.
   * @memberof module:World
   * @returns {ArrayBuffer} Snapshot of the ECS state.
   */
  const save = () => {
    const entityCursor = getEntityCursor()
    const entityCount = getEntityCount()

    const componentNames = Object.keys(registry.components)
    const managers = componentNames.map(name => registry.components[name])

    const systemNames = Object.keys(registry.systems)
    const systems = systemNames.map(name => registry.systems[name])
    
    // how many generations of components
    const generations = Math.ceil(componentNames.length / 32)
    
    // get total byte sums
    const totalEntityBytes = entityCount * generations * Uint32Array.BYTES_PER_ELEMENT
    const totalComponentBytes = managers.reduce((a,m) => a + m._flatten().reduce((b,c) => b + c.BYTES_PER_ELEMENT * entityCount, 0), 0)
    const totalSystemBytes = systems.reduce((a,s) => a + s.localEntities.reduce((b,c) => b + Uint32Array.BYTES_PER_ELEMENT, 0) + Uint32Array.BYTES_PER_ELEMENT, 0)

    // make buffer to write to and dataview to write with
    const buffer = new ArrayBuffer(totalEntityBytes + totalComponentBytes + totalSystemBytes)
    const view = new DataView(buffer)
    let viewCursor = 0

    // serialize entity masks
    for (let i = 0; i < entityCount; i++) {
      for (let k = 0; k < generations; k++) {
        const mask = registry.entities[k]
        view.setUint32(viewCursor, mask[i])
        viewCursor += Uint32Array.BYTES_PER_ELEMENT
      }
    }
    
    // serialize component data
    managers.forEach(manager => {
      manager._flatten().forEach(typedArray => {
        const typeName = typedArray.constructor.name.split('Array')[0]
        const bytesPerElement = typedArray.BYTES_PER_ELEMENT
        const toIndex = entityCursor
        typedArray._cursorStart = viewCursor
        for (let i = 0; i < toIndex; i++) {
          view[`set${typeName}`](viewCursor, typedArray[i])
          viewCursor += bytesPerElement
        }
        typedArray._cursorEnd = viewCursor
      })
    })

    // serialize localEntities from systems
    systemNames.forEach(name => {
      const system = registry.systems[name]

      view.setUint32(viewCursor, system.localEntities.length)
      viewCursor += Uint32Array.BYTES_PER_ELEMENT
      
      system.localEntities.forEach(eid => {
        view.setUint32(viewCursor, eid)
        viewCursor += Uint32Array.BYTES_PER_ELEMENT
      })
    })

    return view.buffer.slice(0, viewCursor)
  }

  /**
   * Loads a snapshot that was saved with the same ECS setup.
   * @memberof module:World
   * @param {ArrayBuffer} bin 
   */
  const load = (bin) => {
    const entityCursor = getEntityCursor()
    const entityCount = getEntityCount()

    const componentNames = Object.keys(registry.components)
    const managers = componentNames.map(name => registry.components[name])

    const systemNames = Object.keys(registry.systems)
    
    // how many generations of components
    const generations = Math.ceil(componentNames.length / 32)

    const view = new DataView(bin)
    let viewCursor = 0

    // deserialize entity masks
    for (let i = 0; i < entityCount; i++) {
      for (let k = 0; k < generations; k++) {
        const mask = registry.entities[k]
        mask[i] = view.getUint32(viewCursor)
        viewCursor += Uint32Array.BYTES_PER_ELEMENT
      }
    }

    // deserialize component data
    managers.forEach(manager => {
      manager._flatten().forEach(typedArray => {
        const typeName = typedArray.constructor.name.split('Array')[0]
        const bytesPerElement = typedArray.BYTES_PER_ELEMENT
        const toIndex = entityCursor
        for (let i = 0; i < toIndex; i++) {
          typedArray[i] = view[`get${typeName}`](viewCursor)
          viewCursor += bytesPerElement
        }
      })
    })

    // deserialize all system localEntities
    systemNames.forEach(name => {
      const system = registry.systems[name]

      const count = view.getUint32(viewCursor)
      viewCursor += Uint32Array.BYTES_PER_ELEMENT
      
      system.localEntities.length = 0
      system.count = 0
      system.entityIndices.fill(-1)
      for (let i = 0; i < count; i++) {
        const eid = view.getUint32(viewCursor)
        system.add(eid)
        viewCursor += Uint32Array.BYTES_PER_ELEMENT
      }
    })

  }

  return {
    save,
    load
  }
}